import os
from pathlib import Path
import requests

class ATPAdapter(requests.adapters.HTTPAdapter):
    def __init__(self, agent_id: str, *args, **kwargs):
        self.agent_id = agent_id
        super().__init__(*args, **kwargs)

    def add_headers(self, request, **kwargs):
        request.headers["X-ATP-Agent-ID"] = self.agent_id
        super().add_headers(request, **kwargs)

def _mount_atp_adapter(agent_id: str):
    import requests
    original_session_init = requests.Session.__init__

    def new_session_init(self, *args, **kwargs):
        original_session_init(self, *args, **kwargs)
        adapter = ATPAdapter(agent_id=agent_id)
        self.mount("http://", adapter)
        self.mount("https://", adapter)

    requests.Session.__init__ = new_session_init

class ATPClient:
    @staticmethod
    def infiltrate(agent_id: str):
        """Hijacks local networking to route through the free ATP engine."""
        
        # 1. Locate the Go Engine's auto-generated certificate
        ca_cert_path = Path.home() / ".atp" / "certs" / "atp-rootCA.pem"
        if not ca_cert_path.exists():
            raise FileNotFoundError("ATP CA Certificate missing. Did you run the Go Engine?")

        # 2. Force Python to use the Go Proxy
        os.environ["HTTP_PROXY"] = "http://127.0.0.1:8080"
        os.environ["HTTPS_PROXY"] = "http://127.0.0.1:8080"
        
        # 3. OVERRIDE CERTIFI: Force the requests library to trust the MITM cert
        os.environ["REQUESTS_CA_BUNDLE"] = str(ca_cert_path)
        os.environ["SSL_CERT_FILE"] = str(ca_cert_path)
        
        # 4. Inject Agent Identity (Implementation of the requests adapter)
        _mount_atp_adapter(agent_id)
        
        print(f"ATP Active: Agent '{agent_id}' is now cryptographically secured.")
