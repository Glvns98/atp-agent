import re

with open('main.go.bak', 'r') as f:
    content = f.read()

# 1. Update imports
imports_addition = '''
	"crypto/tls"
	"database/sql"
	"embed"
	"io/fs"
	"path/filepath"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	_ "modernc.org/sqlite"
'''
content = re.sub(r'(import \(\n)', r'\g<1>' + imports_addition, content)

# 2. Add dashboardFS
embed_decl = '''
//go:embed public/*
var dashboardFS embed.FS
var db *sql.DB
'''
content = re.sub(r'(var \(\n\s+ctx\s+=\s+context\.Background\(\))', embed_decl + r'\n\g<1>', content)

# 3. Replace initTelemetry with initDB
init_db_func = '''
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
			if err != nil { log.Printf("DB error: %v", err) }
			
			for client := range clients {
				err := client.WriteJSON(event)
				if err != nil {
					client.Close()
					delete(clients, client)
				}
			}
		}
	}()
}
'''
content = re.sub(r'func initTelemetry\(\) \{[\s\S]*?(?=\nfunc recordEvent)', init_db_func, content)

# 4. Replace initTelemetry() call with initCerts() and initDB()
content = content.replace('initTelemetry()', 'initCerts()\n\tinitDB()')

# 5. Fix telemetryHandler to read from SQLite
telemetry_handler = '''
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
			if argsStr.Valid { json.Unmarshal([]byte(argsStr.String), &evt.Arguments) }
			if reason.Valid { evt.Reason = reason.String }
			if escID.Valid { evt.EscalationID = escID.String }
			if proof.Valid { evt.Proof = proof.String }
			if prevHash.Valid { evt.PrevHash = prevHash.String }
			events = append([]TelemetryEvent{evt}, events...) // Reverse to chronological
		}
	}
	sendJSON(w, map[string]interface{}{"events": events})
}
'''
content = re.sub(r'func telemetryHandler\([^)]+\) \{[\s\S]*?(?=\nfunc policiesHandler)', telemetry_handler, content)

# 6. Add initCerts logic
init_certs = '''
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
			SerialNumber: serialNumber,
			Subject: pkix.Name{Organization: []string{"ATP Open Standard"}},
			NotBefore: time.Now(),
			NotAfter: time.Now().AddDate(10, 0, 0),
			KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
			BasicConstraintsValid: true,
			IsCA: true,
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
'''
content = content + '\n' + init_certs

# 7. Remove the old goproxy CA export in startProxy
content = re.sub(r'// Expose Root CA for Python SDK[\s\S]*?os\.WriteFile\(certPath, goproxy\.CA_CERT, 0644\)', '', content)

# 8. Add frontend file serving
mux_serving = '''
	subFS, err := fs.Sub(dashboardFS, "public")
	if err != nil {
		log.Println("No embedded dashboard found, skipping UI")
	} else {
		mux.Handle("/", http.FileServer(http.FS(subFS)))
	}
'''
content = re.sub(r'(log\.Println\("Enterprise Control Plane listening on :8081"\))', mux_serving + r'\n\t\g<1>', content)

# 9. Fix auditVerifyHandler
audit_verify = '''
func auditVerifyHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	if r.Method == http.MethodOptions { return }

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

		if argsStr.Valid { json.Unmarshal([]byte(argsStr.String), &evt.Arguments) }
		if reason.Valid { evt.Reason = reason.String }
		if escID.Valid { evt.EscalationID = escID.String }
		if proof.Valid { evt.Proof = proof.String }
		if prevHash.Valid { evt.PrevHash = prevHash.String }

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
'''
content = re.sub(r'func auditVerifyHandler\([^)]+\) \{[\s\S]*?(?=\n// ATP MITM PROXY Logic)', audit_verify, content)

with open('main.go', 'w') as f:
    f.write(content)

print("Patch applied.")
