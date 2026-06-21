package gateway

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
)

// Infiltrate customizes the default http.DefaultClient to route through ATP
// and inject the required Agent ID header.
func Infiltrate(agentID string) error {
	fmt.Printf("[ATP] Infiltrating Go network stack for agent: %s...\n", agentID)

	proxyURLStr := os.Getenv("ATP_PROXY_URL")
	if proxyURLStr == "" {
		proxyURLStr = "http://127.0.0.1:8080"
	}

	proxyURL, err := url.Parse(proxyURLStr)
	if err != nil {
		return fmt.Errorf("failed to parse ATP proxy URL: %v", err)
	}

	// Try to find the Root CA
	caPaths := []string{
		"/certs/atp-rootCA.pem",
		"/app/certs/atp-rootCA.pem",
		filepath.Join("..", "..", "..", "engine", "atp-rootCA.pem"), // local dev fallback
	}

	var caCert []byte
	for _, p := range caPaths {
		if cert, err := os.ReadFile(p); err == nil {
			caCert = cert
			fmt.Printf("[ATP] Loaded MITM Root CA from %s\n", p)
			break
		}
	}

	tlsConfig := &tls.Config{
		InsecureSkipVerify: true, // Required as goproxy certificates often miss SANs/KeyUsage
	}

	if caCert != nil {
		caCertPool := x509.NewCertPool()
		caCertPool.AppendCertsFromPEM(caCert)
		tlsConfig.RootCAs = caCertPool
	} else {
		fmt.Println("[ATP] WARNING: Root CA not found. Intercepted HTTPS requests may fail.")
	}

	// Create a custom transport
	transport := &http.Transport{
		Proxy:           http.ProxyURL(proxyURL),
		TLSClientConfig: tlsConfig,
	}

	// Create a round tripper to inject the header
	http.DefaultTransport = &atpRoundTripper{
		agentID:   agentID,
		transport: transport,
	}

	fmt.Println("[ATP] Network stack successfully hijacked. All traffic routing through L7 Proxy.")
	return nil
}

type atpRoundTripper struct {
	agentID   string
	transport http.RoundTripper
}

func (rt *atpRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	// Clone request to avoid mutating the original
	cloned := req.Clone(req.Context())
	if cloned.Header == nil {
		cloned.Header = make(http.Header)
	}
	cloned.Header.Set("X-ATP-Agent-ID", rt.agentID)
	return rt.transport.RoundTrip(cloned)
}
