package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"database/sql"

	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"

	"log"
	"math/big"
	_ "modernc.org/sqlite"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/elazarl/goproxy"
	"github.com/gorilla/websocket"
	"gopkg.in/yaml.v2"
)

// Policy and API Models
type Capability struct {
	Scope         string  `yaml:"scope" json:"scope"`
	MaxAmount     float64 `yaml:"max_amount" json:"max_amount"`
	EscalateAbove float64 `yaml:"escalate_above" json:"escalate_above"`
	Reversible    bool    `yaml:"reversible" json:"reversible"`
	Granted       *bool   `yaml:"granted" json:"granted"`
}

type AgentConfig struct {
	Role         string       `yaml:"role" json:"role"`
	Capabilities []Capability `yaml:"capabilities" json:"capabilities"`
	Default      string       `yaml:"default" json:"default"`
}

type DLPConfig struct {
	MaxPayloadBytes int      `yaml:"max_payload_bytes" json:"max_payload_bytes"`
	BlockedKeywords []string `yaml:"blocked_keywords" json:"blocked_keywords"`
}

type PolicyConfig struct {
	Enforcement map[string]string      `yaml:"enforcement" json:"enforcement"`
	Agents      map[string]AgentConfig `yaml:"agents" json:"agents"`
	Roles       map[string]interface{} `yaml:"roles" json:"roles"`
	DLP         DLPConfig              `yaml:"dlp" json:"dlp"`
}

type EscalationTask struct {
	ID        string  `json:"id"`
	State     string  `json:"state"` // PENDING, ALLOW, BLOCK
	AgentID   string  `json:"agent_id"`
	Action    string  `json:"action"`
	Amount    float64 `json:"amount"`
	Timestamp string  `json:"timestamp"`

	// ATP specific
	Req       *http.Request `json:"-"`
	BodyBytes []byte        `json:"-"`
	WaitChan  chan bool     `json:"-"`
}

type EscalationResolveReq struct {
	EscalationID string `json:"escalation_id"`
	Decision     string `json:"decision"` // ALLOW or BLOCK
}

// Circuit Breaker (Phase 5)
type CircuitBreaker struct {
	State        string
	TripTime     time.Time
	RequestCount int
	WindowStart  time.Time
}

// Telemetry Event Model
type TelemetryEvent struct {
	Timestamp    string                 `json:"timestamp"`
	AgentID      string                 `json:"agent_id"`
	Action       string                 `json:"action"`
	Arguments    map[string]interface{} `json:"arguments"`
	Status       string                 `json:"status"`
	Reason       string                 `json:"reason,omitempty"`
	EscalationID string                 `json:"escalation_id,omitempty"`
	Proof        string                 `json:"proof,omitempty"`
	PrevHash     string                 `json:"prev_hash,omitempty"`
}


var db *sql.DB

var (
	ctx            = context.Background()
	dlpConfig      DLPConfig
	agentConfigMap = make(map[string]AgentConfig)
	policyLock     sync.RWMutex

	escalations     = make(map[string]*EscalationTask)
	escalationsLock sync.RWMutex

	// Taint Tracking (Phase 3)
	taintMap  = make(map[string]time.Time)
	taintLock sync.RWMutex

	breakerMap  = make(map[string]*CircuitBreaker)
	breakerLock sync.RWMutex

	// In-memory velocity tracking
	agentDailySpent = make(map[string]float64)
	agentDailyLock  sync.RWMutex

	// WebSocket clients
	clients   = make(map[*websocket.Conn]bool)
	broadcast = make(chan TelemetryEvent, 100)
	upgrader  = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	telemetryFile *os.File

	// Phase 7: Control Plane variables
	globalKillSwitchActive bool
	globalKillSwitchLock   sync.RWMutex
	suspendedAgents        = make(map[string]string)
	suspendedAgentsLock    sync.RWMutex
)

func generateID() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

func loadPolicies() {
	data, err := os.ReadFile("policy.yaml")
	if err != nil {
		log.Fatalf("Failed to read policy.yaml: %v", err)
	}
	var config PolicyConfig
	if err := yaml.Unmarshal(data, &config); err != nil {
		log.Fatalf("Failed to parse policy.yaml: %v", err)
	}

	policyLock.Lock()
	defer policyLock.Unlock()
	dlpConfig = config.DLP
	agentConfigMap = config.Agents
	log.Println("RBAC Policies loaded successfully.")
}

func initDB() {
	home, _ := os.UserHomeDir()
	atpDir := filepath.Join(home, ".atp")
	os.MkdirAll(atpDir, 0755)
	dbPath := filepath.Join(atpDir, "ledger.db")

	var err error
	db, err = sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatalf("Failed to open DB: %v", err)
	}

	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS logs (
		id TEXT PRIMARY KEY,
		agent_id TEXT,
		timestamp TEXT,
		action TEXT,
		arguments TEXT,
		status TEXT,
		reason TEXT,
		escalation_id TEXT,
		proof TEXT,
		prev_hash TEXT
	)`)
	if err != nil {
		log.Fatalf("Failed to create table: %v", err)
	}

	go func() {
		lastHash := "0000000000000000000000000000000000000000000000000000000000000000"
		db.QueryRow("SELECT prev_hash FROM logs ORDER BY timestamp DESC LIMIT 1").Scan(&lastHash)

		for {
			event := <-broadcast
			event.PrevHash = lastHash
			eventJSON, _ := json.Marshal(event)
			hashBytes := sha256.Sum256(eventJSON)
			lastHash = hex.EncodeToString(hashBytes[:])

			argsJSON, _ := json.Marshal(event.Arguments)
			_, err := db.Exec("INSERT INTO logs (id, agent_id, timestamp, action, arguments, status, reason, escalation_id, proof, prev_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
				generateID(), event.AgentID, event.Timestamp, event.Action, string(argsJSON), event.Status, event.Reason, event.EscalationID, event.Proof, lastHash)
			if err != nil {
				log.Printf("DB error: %v", err)
			}

			for client := range clients {
				err := client.WriteJSON(event)
				if err != nil {
					client.Close()
					delete(clients, client)
				}
			}

			// PUSH to Centralized SaaS if configured
			cloudURL := os.Getenv("ATP_CLOUD_URL")
			if cloudURL != "" {
				go func(e TelemetryEvent) {
					payload, _ := json.Marshal(e)
					http.Post(cloudURL+"/v1/ingest", "application/json", bytes.NewBuffer(payload))
				}(event)
			}
		}
	}()
}

func recordEvent(agentID, action, status, reason, escID, proof string, args map[string]interface{}) {
	event := TelemetryEvent{
		Timestamp:    time.Now().Format(time.RFC3339Nano),
		AgentID:      agentID,
		Action:       action,
		Arguments:    args,
		Status:       status,
		Reason:       reason,
		EscalationID: escID,
		Proof:        proof,
	}
	select {
	case broadcast <- event:
	default:
		log.Println("Warning: Broadcast channel full")
	}
}

func sendJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func ingestTelemetryHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	if r.Method == http.MethodOptions {
		return
	}

	var evt TelemetryEvent
	if err := json.NewDecoder(r.Body).Decode(&evt); err != nil {
		sendJSON(w, map[string]interface{}{"status": "error", "message": "Invalid event"})
		return
	}

	// We strip the local developer's hash, and drop it into the Master Cloud Ledger
	evt.PrevHash = ""
	
	select {
	case broadcast <- evt:
		sendJSON(w, map[string]interface{}{"status": "ingested"})
	default:
		sendJSON(w, map[string]interface{}{"status": "error", "message": "Cloud broadcast full"})
	}
}

// REST Control Plane Handlers
func escalationPendingHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	escalationsLock.RLock()
	var pending []EscalationTask
	for _, task := range escalations {
		if task.State == "PENDING" {
			pending = append(pending, *task)
		}
	}
	escalationsLock.RUnlock()
	sendJSON(w, map[string]interface{}{"pending": pending})
}

func escalationResolveHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		return
	}
	var req EscalationResolveReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	escalationsLock.Lock()
	task, exists := escalations[req.EscalationID]
	if exists && task.State == "PENDING" {
		task.State = req.Decision
		if req.Decision == "ALLOW" {
			agentDailyLock.Lock()
			agentDailySpent[task.AgentID] += task.Amount
			agentDailyLock.Unlock()
		}
		// Unblock the proxy thread
		task.WaitChan <- true
	}
	escalationsLock.Unlock()

	if exists {
		recordEvent("human", "resolve_escalation", req.Decision, "", req.EscalationID, "", map[string]interface{}{"target_agent": task.AgentID, "amount": task.Amount})
	}
	sendJSON(w, map[string]string{"status": "OK"})
}

func telemetryHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	rows, err := db.Query("SELECT agent_id, timestamp, action, arguments, status, reason, escalation_id, proof, prev_hash FROM logs ORDER BY timestamp DESC LIMIT 200")
	if err != nil {
		sendJSON(w, map[string]interface{}{"events": []TelemetryEvent{}})
		return
	}
	defer rows.Close()

	var events []TelemetryEvent
	for rows.Next() {
		var evt TelemetryEvent
		var argsStr, reason, escID, proof, prevHash sql.NullString
		err := rows.Scan(&evt.AgentID, &evt.Timestamp, &evt.Action, &argsStr, &evt.Status, &reason, &escID, &proof, &prevHash)
		if err == nil {
			if argsStr.Valid {
				json.Unmarshal([]byte(argsStr.String), &evt.Arguments)
			}
			if reason.Valid {
				evt.Reason = reason.String
			}
			if escID.Valid {
				evt.EscalationID = escID.String
			}
			if proof.Valid {
				evt.Proof = proof.String
			}
			if prevHash.Valid {
				evt.PrevHash = prevHash.String
			}
			events = append([]TelemetryEvent{evt}, events...) // Reverse to chronological
		}
	}
	sendJSON(w, map[string]interface{}{"events": events})
}

func policiesHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodGet {
		policyLock.RLock()
		defer policyLock.RUnlock()
		sendJSON(w, agentConfigMap)
		return
	}

	if r.Method == http.MethodPost {
		var config PolicyConfig
		if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
			http.Error(w, "Bad request", http.StatusBadRequest)
			return
		}
		data, _ := yaml.Marshal(&config)
		os.WriteFile("policy.yaml", data, 0644)

		policyLock.Lock()
		dlpConfig = config.DLP
		agentConfigMap = config.Agents
		policyLock.Unlock()
		w.WriteHeader(http.StatusOK)
	}
}

func streamHandler(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	clients[ws] = true
	go func() {
		defer func() { ws.Close(); delete(clients, ws) }()
		for {
			if _, _, err := ws.ReadMessage(); err != nil {
				break
			}
		}
	}()
}

// Phase 7: Kill Switch Handler
func killswitchHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		return
	}

	globalKillSwitchLock.Lock()
	defer globalKillSwitchLock.Unlock()

	if r.Method == http.MethodPost {
		var req map[string]bool
		if err := json.NewDecoder(r.Body).Decode(&req); err == nil {
			if active, ok := req["active"]; ok {
				globalKillSwitchActive = active
				status := "Deactivated"
				if active {
					status = "Activated"
				}
				recordEvent("system", "kill_switch", "ALLOW", fmt.Sprintf("Global Kill Switch %s", status), "", "", nil)
			}
		}
	}
	sendJSON(w, map[string]bool{"active": globalKillSwitchActive})
}

// Phase 6: Audit Chain Verifier Handler

func auditVerifyHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	if r.Method == http.MethodOptions {
		return
	}

	rows, err := db.Query("SELECT id, agent_id, timestamp, action, arguments, status, reason, escalation_id, proof, prev_hash FROM logs ORDER BY timestamp ASC")
	if err != nil {
		sendJSON(w, map[string]interface{}{"status": "error", "message": "Failed to read telemetry DB"})
		return
	}
	defer rows.Close()

	expectedHash := "0000000000000000000000000000000000000000000000000000000000000000"
	line := 1

	for rows.Next() {
		var evt TelemetryEvent
		var argsStr, reason, escID, proof, prevHash, id sql.NullString
		err := rows.Scan(&id, &evt.AgentID, &evt.Timestamp, &evt.Action, &argsStr, &evt.Status, &reason, &escID, &proof, &prevHash)
		if err != nil {
			sendJSON(w, map[string]interface{}{"status": "error", "message": "DB corruption"})
			return
		}

		if argsStr.Valid {
			json.Unmarshal([]byte(argsStr.String), &evt.Arguments)
		}
		if reason.Valid {
			evt.Reason = reason.String
		}
		if escID.Valid {
			evt.EscalationID = escID.String
		}
		if proof.Valid {
			evt.Proof = proof.String
		}
		if prevHash.Valid {
			evt.PrevHash = prevHash.String
		}

		if evt.PrevHash != expectedHash {
			sendJSON(w, map[string]interface{}{"status": "corrupt", "line": line, "message": fmt.Sprintf("Hash mismatch. Expected: %s, Found: %s", expectedHash, evt.PrevHash)})
			return
		}

		eventJSON, _ := json.Marshal(evt)
		hashBytes := sha256.Sum256(eventJSON)
		expectedHash = hex.EncodeToString(hashBytes[:])
		line++
	}
	sendJSON(w, map[string]interface{}{"status": "valid", "message": "Chain is fully intact"})
}

func auditVerifyFileHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	if r.Method == http.MethodOptions {
		return
	}

	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		sendJSON(w, map[string]interface{}{"status": "error", "message": "Failed to read file"})
		return
	}
	
	bodyStr := string(bodyBytes)
	
	// 1. Full-Document Tamper Verification
	sigMarker := "\n--- DOCUMENT SIGNATURE ---\nSHA256: "
	if !strings.Contains(bodyStr, sigMarker) {
		sendJSON(w, map[string]interface{}{"status": "error", "message": "Missing Document Signature"})
		return
	}

	parts := strings.Split(bodyStr, sigMarker)
	if len(parts) < 2 {
		sendJSON(w, map[string]interface{}{"status": "error", "message": "Malformed Document Signature"})
		return
	}

	markdownBody := parts[0]
	extractedHash := strings.TrimSpace(parts[1])

	// Recompute hash of the Markdown Body
	hashBytes := sha256.Sum256([]byte(markdownBody))
	recomputedHash := hex.EncodeToString(hashBytes[:])

	if recomputedHash != extractedHash {
		sendJSON(w, map[string]interface{}{"status": "corrupt", "message": "TEXT TAMPERED: The document text was modified!"})
		return
	}
	
	// 2. Cryptographic Ledger Verification
	// Extract the JSON payload from the intact body
	jsonPayload := markdownBody
	if strings.Contains(markdownBody, "```json") {
		startIdx := strings.Index(markdownBody, "```json") + 7
		endIdx := strings.LastIndex(markdownBody, "```")
		if startIdx > 6 && endIdx > startIdx {
			jsonPayload = markdownBody[startIdx:endIdx]
		}
	}

	var events []TelemetryEvent
	if err := json.Unmarshal([]byte(jsonPayload), &events); err != nil {
		sendJSON(w, map[string]interface{}{"status": "error", "message": "Invalid JSON payload or signature corrupt"})
		return
	}

	expectedHash := "0000000000000000000000000000000000000000000000000000000000000000"
	
	// Events might be ordered newest first if downloaded directly from the UI state,
	// so we sort them oldest first based on timestamp to re-verify the chain.
	// But actually, the array downloaded from the UI might be newest-first,
	// so let's reverse it if necessary, or just rely on the UI to send it oldest-first.
	// We'll reverse it here if the first element is newer than the last element.
	if len(events) > 1 && events[0].Timestamp > events[len(events)-1].Timestamp {
		for i, j := 0, len(events)-1; i < j; i, j = i+1, j-1 {
			events[i], events[j] = events[j], events[i]
		}
	}

	for i, evt := range events {
		if evt.PrevHash != expectedHash {
			sendJSON(w, map[string]interface{}{
				"status": "corrupt", 
				"index": i, 
				"message": fmt.Sprintf("Hash mismatch at event %d. Expected: %s, Found: %s", i, expectedHash, evt.PrevHash),
			})
			return
		}

		eventJSON, _ := json.Marshal(evt)
		hashBytes := sha256.Sum256(eventJSON)
		expectedHash = hex.EncodeToString(hashBytes[:])
	}
	sendJSON(w, map[string]interface{}{"status": "valid", "message": "Uploaded report is Cryptographically Authentic"})
}

// ATP MITM PROXY Logic
var (
	coralPubKey  ed25519.PublicKey
	coralPrivKey ed25519.PrivateKey
)

func init() {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		panic(err)
	}
	coralPubKey = pub
	coralPrivKey = priv
}

func generateCORALSignature(agentID, canonicalReq, decisionID, evaluator, parentReqID string) string {
	timestamp := time.Now().UnixNano()
	data := fmt.Sprintf("policy_version:v2.0|decision_id:%s|evaluator:%s|parent_request_id:%s|agent_id:%s|canonical_req:%s|timestamp:%d", decisionID, evaluator, parentReqID, agentID, canonicalReq, timestamp)
	hash := sha256.Sum256([]byte(data))

	// Phase 9: CORAL Cryptographic Audit Signature (Ed25519)
	sig := ed25519.Sign(coralPrivKey, hash[:])

	return "CORAL-ED25519-" + hex.EncodeToString(sig)[:32]
}

type atpLogger struct{}

func (l *atpLogger) Printf(format string, v ...interface{}) {
	msg := fmt.Sprintf(format, v...)
	// Catch standard Go TLS library warnings and goproxy MITM errors
	if strings.Contains(strings.ToLower(msg), "remote error: tls") || strings.Contains(strings.ToLower(msg), "certificate signed by unknown authority") || strings.Contains(strings.ToLower(msg), "tls: bad certificate") {
		recordEvent("anonymous-agent", "tls_handshake", "WARN", "Potential certificate pinning bypass attempt: "+msg, "", "", nil)
	}
	log.Printf(format, v...)
}

func startProxy() {

	proxy := goproxy.NewProxyHttpServer()
	proxy.Verbose = true // Required to intercept the TLS MITM warnings
	proxy.Logger = &atpLogger{}
	proxy.OnRequest().HandleConnect(goproxy.AlwaysMitm)

	// Phase 3: Taint Tracking Inbound Hook
	proxy.OnResponse().DoFunc(
		func(resp *http.Response, ctx *goproxy.ProxyCtx) *http.Response {
			if resp == nil || resp.Request == nil {
				return resp
			}
			
			agentID := resp.Request.Header.Get("X-ATP-Agent-ID")
			if agentID == "" {
				agentID = "anonymous-agent"
			}

			// 1. Trust labeling at ingestion
			if resp.Header == nil {
				resp.Header = make(http.Header)
			}
			resp.Header.Set("X-ATP-Trust-Label", "external_untrusted")
			
			// 2. Update taint window
			taintLock.Lock()
			taintMap[agentID] = time.Now()
			taintLock.Unlock()
			
			recordEvent(agentID, "fetch_untrusted", "WARN", "Ingested untrusted external content. Taint window active.", "", "", map[string]interface{}{"url": resp.Request.URL.String()})

			return resp
		})

	proxy.OnRequest().DoFunc(
		func(r *http.Request, ctx *goproxy.ProxyCtx) (*http.Request, *http.Response) {
			// Bypass localhost control plane
			if r.URL.Host == "localhost:8081" || r.URL.Host == "127.0.0.1:8081" {
				return r, nil
			}

			agentID := r.Header.Get("X-ATP-Agent-ID")
			if agentID == "" {
				agentID = "anonymous-agent"
			}

			// Phase 7: Global Kill Switch Check
			globalKillSwitchLock.RLock()
			if globalKillSwitchActive {
				globalKillSwitchLock.RUnlock()
				recordEvent(agentID, "kill_switch", "BLOCK", "Global Kill Switch is ACTIVE", "", "", nil)
				return r, goproxy.NewResponse(r, "application/json", 503, `{"error":"ATP: Global Kill Switch is ACTIVE"}`)
			}
			globalKillSwitchLock.RUnlock()

			// Capture payload
			var bodyBytes []byte
			if r.Body != nil {
				bodyBytes, _ = io.ReadAll(r.Body)
				r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
			}

			// Parse dummy action for testing. If body has {"amount": X}, it's a "refund".
			// In production, policy routes on URL and payloads.
			action := r.URL.Host
			var amount float64
			var args map[string]interface{}
			if len(bodyBytes) > 0 {
				json.Unmarshal(bodyBytes, &args)
				if val, ok := args["amount"]; ok {
					action = "refund"
					amount, _ = val.(float64)
				}
			}

			policyLock.RLock()
			localDLP := dlpConfig
			policyLock.RUnlock()

			// 1. Enforce Max Payload Bytes
			if localDLP.MaxPayloadBytes > 0 && len(bodyBytes) > localDLP.MaxPayloadBytes {
				recordEvent(agentID, action, "BLOCK", "Payload exceeds max allowed bytes", "", "", args)
				return r, goproxy.NewResponse(r, "application/json", 403, `{"error":"ATP: Payload Too Large"}`)
			}

			// 2. Enforce Keyword DLP
			upperBody := bytes.ToUpper(bodyBytes)
			for _, keyword := range localDLP.BlockedKeywords {
				if bytes.Contains(upperBody, bytes.ToUpper([]byte(keyword))) {
					reason := fmt.Sprintf("DLP Violation: Matched forbidden keyword '%s'", keyword)
					recordEvent(agentID, action, "BLOCK", reason, "", "", args)
					return r, goproxy.NewResponse(r, "application/json", 403, `{"error":"ATP: DLP Violation"}`)
				}
			}
			// 3. Schema Enforcement (Phase 6)
			if len(bodyBytes) > 0 {
				var rawMap map[string]interface{}
				if err := json.Unmarshal(bodyBytes, &rawMap); err != nil {
					recordEvent(agentID, action, "BLOCK", "Schema Violation: Malformed JSON payload", "", "", nil)
					return r, goproxy.NewResponse(r, "application/json", 400, `{"error":"ATP: Malformed JSON"}`)
				}
				for k := range rawMap {
					if k != "action" && k != "amount" && k != "asset" {
						recordEvent(agentID, action, "BLOCK", fmt.Sprintf("Schema Violation: Undocumented field '%s'", k), "", "", args)
						return r, goproxy.NewResponse(r, "application/json", 400, fmt.Sprintf(`{"error":"ATP: Schema Violation - Invalid field '%s'"}`, k))
					}
				}
			}
			// Parse action scope for capability matching
			scope := "payments:refund" // default
			if actionRaw, ok := args["action"].(string); ok {
				scope = "payments:" + actionRaw
				action = actionRaw
			}

			// Circuit Breaker / Anomaly Detection (Phase 5)
			breakerLock.Lock()
			cb, exists := breakerMap[agentID]
			if !exists {
				cb = &CircuitBreaker{State: "CLOSED", WindowStart: time.Now()}
				breakerMap[agentID] = cb
			}

			// 10 second rolling window
			if time.Since(cb.WindowStart) > 10*time.Second {
				cb.RequestCount = 0
				cb.WindowStart = time.Now()
			}
			cb.RequestCount++

			if cb.State == "OPEN" {
				if time.Since(cb.TripTime) > 60*time.Second {
					cb.State = "HALF_OPEN"
				} else {
					breakerLock.Unlock()
					recordEvent(agentID, scope, "BLOCK", "Circuit Breaker OPEN (Suspended)", "", "", args)
					return r, goproxy.NewResponse(r, "application/json", 403, `{"error":"ATP: Circuit Breaker OPEN"}`)
				}
			}

			// Anomaly: > 5 requests in 10 seconds
			if cb.RequestCount > 5 && cb.State == "CLOSED" {
				cb.State = "OPEN"
				cb.TripTime = time.Now()
				breakerLock.Unlock()
				recordEvent(agentID, scope, "BLOCK", "Anomaly Detected: Velocity Spike. Circuit Breaker tripped.", "", "", args)
				return r, goproxy.NewResponse(r, "application/json", 403, `{"error":"ATP: Anomaly Detected"}`)
			}
			breakerLock.Unlock()

			// Evaluate Policy (RBAC Default Deny)
			policyLock.RLock()
			agentCfg, agentExists := agentConfigMap[agentID]
			policyLock.RUnlock()

			if !agentExists {
				recordEvent(agentID, scope, "BLOCK", "Agent identity not registered (Default Deny)", "", "", args)
				return r, goproxy.NewResponse(r, "application/json", 403, `{"error":"ATP: Agent Not Registered"}`)
			}

			var matchedCap *Capability
			for _, cap := range agentCfg.Capabilities {
				if cap.Scope == scope {
					if cap.Granted != nil && !*cap.Granted {
						break // Explicit deny
					}
					// Copy capability since cap is loop variable
					c := cap
					matchedCap = &c
					break
				}
			}

			if matchedCap == nil {
				recordEvent(agentID, scope, "BLOCK", "Capability not granted in role (Default Deny)", "", "", args)
				return r, goproxy.NewResponse(r, "application/json", 403, fmt.Sprintf(`{"error":"ATP: Capability %s Not Granted"}`, scope))
			}

			// Taint tracking capability downgrade
			taintLock.RLock()
			taintTime, isTainted := taintMap[agentID]
			taintLock.RUnlock()
			isRecentlyTainted := isTainted && time.Since(taintTime) < 5*time.Minute

			// Enforce capability constraints
			if amount > 0 || !matchedCap.Reversible {
				agentDailyLock.RLock()
				spentToday := agentDailySpent[agentID]
				agentDailyLock.RUnlock()

				isVelocityViolation := (spentToday + amount) > 1000.0 // Fallback daily limit
				isAmountViolation := matchedCap.MaxAmount > 0 && amount > matchedCap.MaxAmount
				isEscalation := (matchedCap.EscalateAbove > 0 && amount > matchedCap.EscalateAbove) || isRecentlyTainted || !matchedCap.Reversible

				if isVelocityViolation {
					recordEvent(agentID, action, "BLOCK", "Velocity Limit Reached", "", "", args)
					return r, goproxy.NewResponse(r, "application/json", 403, `{"error":"ATP: Velocity Limit Reached"}`)
				} else if isAmountViolation {
					recordEvent(agentID, action, "BLOCK", "Exceeds max_amount", "", "", args)
					return r, goproxy.NewResponse(r, "application/json", 403, `{"error":"ATP: Hard Limit Exceeded"}`)
				} else if isEscalation {
					// HITL
					escID := generateID()
					task := &EscalationTask{
						ID: escID, State: "PENDING", AgentID: agentID, Action: action, Amount: amount,
						Timestamp: time.Now().Format(time.RFC3339Nano), Req: r, BodyBytes: bodyBytes,
						WaitChan: make(chan bool),
					}

					escalationsLock.Lock()
					escalations[escID] = task
					escalationsLock.Unlock()

					reason := "Awaiting human approval"
					if isRecentlyTainted {
						reason = "Taint-based capability downgrade (recently ingested untrusted data)"
					} else if !matchedCap.Reversible {
						reason = "Action is irreversible (forced HITL)"
					}
					recordEvent(agentID, action, "ESCALATE", reason, escID, "", args)

					// Freeze thread
					select {
					case <-task.WaitChan:
					case <-time.After(30 * time.Second):
						task.State = "BLOCK"
						recordEvent(agentID, action, "BLOCK", "Escalation timed out", escID, "", args)
						return r, goproxy.NewResponse(r, "application/json", 403, `{"error":"ATP: Escalation Timed Out"}`)
					}

					if task.State == "BLOCK" {
						recordEvent(agentID, action, "BLOCK", "Human denied request", escID, "", args)
						return r, goproxy.NewResponse(r, "application/json", 403, `{"error":"ATP: Human Denied"}`)
					}
					// If ALLOW, proceed
				} else {
					agentDailyLock.Lock()
					agentDailySpent[agentID] += amount
					agentDailyLock.Unlock()
				}
			}

			// Canonical Attestation (Method + URL + Body)
			canonicalReq := r.Method + r.URL.String() + string(bodyBytes)
			parentReqID := r.Header.Get("X-ATP-Parent-Request-ID")
			decisionID := generateID()
			signature := generateCORALSignature(agentID, canonicalReq, decisionID, "rbac", parentReqID)
			r.Header.Set("X-ATP-Proof", signature)
			r.Header.Set("X-ATP-Timestamp", time.Now().UTC().Format(time.RFC3339))

			recordEvent(agentID, action, "ALLOW", "", "", signature, args)
			return r, nil
		})

	proxy.OnResponse().DoFunc(func(resp *http.Response, ctx *goproxy.ProxyCtx) *http.Response {
		if resp == nil || ctx.Req == nil {
			return resp
		}
		if ctx.Req.URL.Host == "localhost:8081" || ctx.Req.URL.Host == "127.0.0.1:8081" {
			return resp
		}
		agentID := ctx.Req.Header.Get("X-ATP-Agent-ID")
		if agentID == "" {
			return resp
		}

		// Inject Trust Label
		resp.Header.Set("X-ATP-Trust-Label", "external_untrusted")

		// Mark agent as tainted
		taintLock.Lock()
		taintMap[agentID] = time.Now()
		taintLock.Unlock()

		recordEvent(agentID, "ingest_data", "WARN", "Ingested untrusted external data", "", "", map[string]interface{}{"source": ctx.Req.URL.String()})
		return resp
	})

	proxyPort := os.Getenv("ATP_PROXY_PORT")
	if proxyPort == "" {
		proxyPort = "8080"
	}

	log.Printf("ATP Layer 7 Proxy listening on :%s", proxyPort)
	log.Fatal(http.ListenAndServe(":"+proxyPort, proxy))
}

func main() {
	loadPolicies()
	initCerts()
	initDB()

	// Start proxy on 8080
	go startProxy()

	// Start control plane on 8081
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/telemetry", telemetryHandler)
	mux.HandleFunc("/v1/escalation/pending", escalationPendingHandler)
	mux.HandleFunc("/v1/escalation/resolve", escalationResolveHandler)
	mux.HandleFunc("/v1/policies", policiesHandler)
	mux.HandleFunc("/v1/stream", streamHandler)
	mux.HandleFunc("/v1/killswitch", killswitchHandler)
	mux.HandleFunc("/v1/audit/verify", auditVerifyHandler)
	mux.HandleFunc("/v1/audit/verify_file", auditVerifyFileHandler)
	mux.HandleFunc("/v1/ingest", ingestTelemetryHandler)

	// Serve the React Enterprise Portal on the root URL
	fs := http.FileServer(http.Dir("dist"))
	mux.Handle("/", fs)

	apiPort := os.Getenv("PORT")
	if apiPort == "" {
		apiPort = os.Getenv("ATP_API_PORT")
		if apiPort == "" {
			apiPort = "8081"
		}
	}

	log.Printf("Enterprise Control Plane listening on :%s", apiPort)
	if err := http.ListenAndServe(":"+apiPort, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func initCerts() {
	home, _ := os.UserHomeDir()
	certDir := filepath.Join(home, ".atp", "certs")
	os.MkdirAll(certDir, 0755)
	certPath := filepath.Join(certDir, "atp-rootCA.pem")
	keyPath := filepath.Join(certDir, "atp-rootCA-key.pem")

	if _, err := os.Stat(certPath); os.IsNotExist(err) {
		log.Println("Generating ATP Root CA...")
		priv, _ := rsa.GenerateKey(rand.Reader, 2048)
		serialNumberLimit := new(big.Int).Lsh(big.NewInt(1), 128)
		serialNumber, _ := rand.Int(rand.Reader, serialNumberLimit)
		template := x509.Certificate{
			SerialNumber:          serialNumber,
			Subject:               pkix.Name{Organization: []string{"ATP Open Standard"}},
			NotBefore:             time.Now(),
			NotAfter:              time.Now().AddDate(10, 0, 0),
			KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
			BasicConstraintsValid: true,
			IsCA:                  true,
		}
		derBytes, _ := x509.CreateCertificate(rand.Reader, &template, &template, &priv.PublicKey, priv)
		certOut, _ := os.Create(certPath)
		pem.Encode(certOut, &pem.Block{Type: "CERTIFICATE", Bytes: derBytes})
		certOut.Close()

		keyOut, _ := os.OpenFile(keyPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0600)
		privBytes, _ := x509.MarshalPKCS8PrivateKey(priv)
		pem.Encode(keyOut, &pem.Block{Type: "PRIVATE KEY", Bytes: privBytes})
		keyOut.Close()
	}

	certBytes, _ := os.ReadFile(certPath)
	keyBytes, _ := os.ReadFile(keyPath)

	// Override goproxy defaults
	goproxy.CA_CERT = certBytes

	cert, err := tls.X509KeyPair(certBytes, keyBytes)
	if err == nil {
		goproxy.GoproxyCa = cert
		goproxy.OkConnect = &goproxy.ConnectAction{Action: goproxy.ConnectAccept, TLSConfig: goproxy.TLSConfigFromCA(&cert)}
		goproxy.MitmConnect = &goproxy.ConnectAction{Action: goproxy.ConnectMitm, TLSConfig: goproxy.TLSConfigFromCA(&cert)}
		goproxy.HTTPMitmConnect = &goproxy.ConnectAction{Action: goproxy.ConnectHTTPMitm, TLSConfig: goproxy.TLSConfigFromCA(&cert)}
		goproxy.RejectConnect = &goproxy.ConnectAction{Action: goproxy.ConnectReject, TLSConfig: goproxy.TLSConfigFromCA(&cert)}
	}
}
