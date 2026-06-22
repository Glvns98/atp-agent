import sys
import os
import requests
import urllib3
import time

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python')))
from gateway import ATPClient

print("--- Starting Chaos Test (Fail-Closed Enforcement) ---")
# If the engine is dead, or if we try to bypass the engine, we should fail.
# Since we are running in the 'agent' container, the 'proxy-net' has NO internet access.

try:
    print("Attempting direct connection to httpbin.org without ATP infiltration...")
    # Clean proxy env vars just in case they were set globally
    os.environ.pop("HTTP_PROXY", None)
    os.environ.pop("HTTPS_PROXY", None)
    os.environ.pop("ATP_PROXY_URL", None)
    
    requests.get("https://httpbin.org/get", timeout=3)
    print("FAILURE: Agent was able to reach the internet directly! Network is NOT isolated.")
    sys.exit(1)
except requests.exceptions.RequestException as e:
    print(f"SUCCESS: Direct egress is physically blocked by Docker Network. ({type(e).__name__})")

print("\nAttempting connection WITH ATP Infiltration...")
# Set it back for tests
os.environ["ATP_PROXY_URL"] = "http://engine:8080"
ATPClient.infiltrate(agent_id="bot-omega")

try:
    response = requests.post("https://httpbin.org/post", json={"amount": 50.0}, timeout=5, verify=False)
    if response.status_code == 200:
        print("SUCCESS: Proxied traffic is working via ATP Engine.")
    else:
        print(f"Proxy returned status: {response.status_code}")
except requests.exceptions.RequestException as e:
    print(f"WARNING: Proxy connection failed. Is the engine running? ({e})")
