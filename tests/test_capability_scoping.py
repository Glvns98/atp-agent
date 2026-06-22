import sys
import os
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python')))
from gateway import ATPClient

print("--- Starting RBAC Capability Scoping Test ---")

# Infiltrate as bot-omega (which only has payments:refund)
ATPClient.infiltrate(agent_id="bot-omega")

print("\n[bot-omega] Attempting to POST to https://httpbin.org/post with action 'transfer' and amount 1.0")
print("This should be blocked because bot-omega does not have the 'payments:transfer' capability.")

try:
    response = requests.post(
        "https://httpbin.org/post",
        json={"action": "transfer", "amount": 1.0, "asset": "USDC"},
        timeout=5,
        verify=False
    )
    
    if response.status_code == 200:
        print("FAILURE: Request was unexpectedly allowed through! Capability scoping failed.")
        sys.exit(1)
    else:
        print(f"SUCCESS: Request BLOCKED by RBAC Engine. Status: {response.status_code}")
        print(f"Reason: {response.text}")
        
except requests.exceptions.RequestException as e:
    print(f"\nRequest Failed: {e}")
