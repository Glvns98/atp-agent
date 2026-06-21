package gateway

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
)

func Infiltrate(agentID string) {
	fmt.Printf("[ATP] Infiltrating Go network stack for agent: %s...\n", agentID)

	proxyStr := os.Getenv("ATP_PROXY_URL")
	if proxyStr == "" {
		proxyStr = "http://127.0.0.1:8080"
	}
	proxyURL, err := url.Parse(proxyStr)
	if err != nil {
		log.Fatalf("Invalid proxy URL: %v", err)
	}

	caPaths := []string{
		"/certs/atp-rootCA.pem",
		"/app/certs/atp-rootCA.pem",
		"../../engine/atp-rootCA.pem",
	}

	var caCertPool *x509.CertPool
	for _, p := range caPaths {
		if caCert, err := os.ReadFile(p); err == nil {
			caCertPool = x509.NewCertPool()
			caCertPool.AppendCertsFromPEM(caCert)
			fmt.Printf("[ATP] Loaded MITM Root CA from %s\n", p)
			break
		}
	}

	if caCertPool == nil {
		fmt.Println("[ATP] WARNING: Root CA not found. Intercepted HTTPS requests may fail.")
	}

	transport := &http.Transport{
		Proxy: http.ProxyURL(proxyURL),
		TLSClientConfig: &tls.Config{
			RootCAs: caCertPool,
			InsecureSkipVerify: caCertPool == nil,
		},
	}

	http.DefaultTransport = &atpTransport{
		transport: transport,
		agentID:   agentID,
	}

	fmt.Println("[ATP] Go Network stack successfully hijacked. All traffic routing through L7 Proxy.")
}

type atpTransport struct {
	transport http.RoundTripper
	agentID   string
}

func (t *atpTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	req.Header.Set("X-ATP-Agent-ID", t.agentID)
	return t.transport.RoundTrip(req)
}
