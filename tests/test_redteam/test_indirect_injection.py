import sys
import os
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'sdk', 'python')))
from gateway import ATPClient

print("--- Red-Team Test: Indirect Prompt Injection ---")
ATPClient.infiltrate(agent_id="bot-omega")

print("\nFetching untrusted external web page...")
response = requests.get("https://httpbin.org/get", timeout=15, verify=False)
trust_label = response.headers.get('X-Atp-Trust-Label')
print(f"Trust Label injected by proxy: {trust_label}")

if trust_label != "external_untrusted":
    print("FAILURE: Proxy did not inject X-ATP-Trust-Label!")
    sys.exit(1)

print("\nAttempting destructive action (refund) that would normally be under the threshold...")
try:
    response = requests.post(
        "https://httpbin.org/post",
        json={"amount": 10.0, "asset": "USDC"},
        timeout=3,
        verify=False
    )
    if response.status_code == 200:
        print("FAILURE: Action was allowed without HITL. Indirect injection taint tracking bypassed!")
        sys.exit(1)
except requests.exceptions.ReadTimeout:
    print("SUCCESS: Taint successfully forced the request into HITL review.")
except requests.exceptions.RequestException as e:
    print(f"Request Failed: {e}")
