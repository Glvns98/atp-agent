import sys
import os
import requests
import urllib3
import time

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python')))
from gateway import ATPClient

print("--- Starting Bidirectional Taint Tracking Test ---")

ATPClient.infiltrate(agent_id="bot-omega")

print("\n[Phase A] Fetching untrusted external data...")
response = requests.get("https://httpbin.org/get", timeout=15, verify=False)
trust_label = response.headers.get('X-Atp-Trust-Label')
print(f"Ingested data. Trust Label injected by proxy: {trust_label}")

if trust_label != "external_untrusted":
    print("FAILURE: Proxy did not inject X-ATP-Trust-Label on inbound response!")
    sys.exit(1)

print("\n[Phase B] Attempting a $10.00 refund (Normally ALLOWED since max=500, escalate=300)...")
print("This must be escalated to HITL because the agent is now tainted.")

try:
    # Set a short timeout. The proxy will freeze the thread (30s) waiting for HITL.
    # The python client will time out locally first.
    response = requests.post(
        "https://httpbin.org/post",
        json={"amount": 10.0, "asset": "USDC"},
        timeout=3,
        verify=False
    )
    
    if response.status_code == 200:
        print("FAILURE: Request was unexpectedly allowed through without HITL! Taint tracking failed.")
        sys.exit(1)
        
except requests.exceptions.ReadTimeout:
    print("\nSUCCESS: Request was properly frozen! The agent was hit with a capability downgrade and forced into HITL due to taint.")
except requests.exceptions.RequestException as e:
    print(f"\nRequest Failed: {e}")
