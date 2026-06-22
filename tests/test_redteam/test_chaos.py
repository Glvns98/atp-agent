import sys
import os
import requests

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'sdk', 'python')))
from gateway import ATPClient

print("--- Starting Red-Team: Chaos Fail-Closed Test ---")

# Step 1: Deliberately misconfigure the Proxy URL to simulate engine crash
os.environ["ATP_PROXY_URL"] = "http://127.0.0.1:9999" # Dead port
ATPClient.infiltrate(agent_id="chaos-bot")

print("\n[Attempt] Trying to egress with the engine offline...")
try:
    requests.post("https://httpbin.org/post", json={"amount": 10.0}, timeout=2, verify=False)
    print("FAILURE: Egress succeeded while engine is offline! Fail-closed invariant broken.")
    sys.exit(1)
except requests.exceptions.RequestException as e:
    print("SUCCESS: Connection refused (Fail-Closed enforced).")
