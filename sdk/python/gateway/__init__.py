import os
import sys
import requests

class ATPClient:
    @staticmethod
    def _verify_supply_chain():
        """Phase 4: Runtime import allow-list check."""
        try:
            if requests.__version__ != "2.31.0":
                print(f"[ATP] WARNING: Supply chain drift detected! requests version {requests.__version__} loaded, expected 2.31.0")
        except AttributeError:
            pass
            
        try:
            import urllib3
            if urllib3.__version__ != "2.1.0":
                print(f"[ATP] WARNING: Supply chain drift detected! urllib3 version {urllib3.__version__} loaded, expected 2.1.0")
        except (ImportError, AttributeError):
            pass
            
        if "langchain" in sys.modules:
            print("[ATP] Notice: LangChain framework detected in memory.")
        if "crewai" in sys.modules:
            print("[ATP] Notice: CrewAI framework detected in memory.")

    @staticmethod
    def infiltrate(agent_id: str):
        ATPClient._verify_supply_chain()
        print(f"[ATP] Infiltrating network stack for agent: {agent_id}...")
        
        proxy_url = os.environ.get("ATP_PROXY_URL", "http://127.0.0.1:8080")
        os.environ["HTTP_PROXY"] = proxy_url
        os.environ["HTTPS_PROXY"] = proxy_url
        
        # Configure trust for the Go Engine's MITM Root CA
        ca_paths = [
            "/certs/atp-rootCA.pem",
            "/app/certs/atp-rootCA.pem",
            os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', 'engine', 'atp-rootCA.pem'))
        ]
        
        ca_path = next((p for p in ca_paths if os.path.exists(p)), None)
        
        if ca_path:
            os.environ["REQUESTS_CA_BUNDLE"] = ca_path
            print(f"[ATP] Loaded MITM Root CA from {ca_path}")
        else:
            print("[ATP] WARNING: Root CA not found. Intercepted HTTPS requests may fail.")

        # Monkey-patch Session.request to globally inject the X-ATP-Agent-ID header
        original_request = requests.Session.request
        
        def atp_request(self, method, url, **kwargs):
            # Ensure headers exist
            headers = kwargs.get('headers', {})
            headers["X-ATP-Agent-ID"] = agent_id
            kwargs['headers'] = headers
            
            # Disable verify since goproxy default CA lacks key usage extensions
            kwargs['verify'] = False
                
            return original_request(self, method, url, **kwargs)

        requests.Session.request = atp_request
        print("[ATP] Network stack successfully hijacked. All traffic routing through L7 Proxy.")
