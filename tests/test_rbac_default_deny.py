import sys
import os
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python')))
from gateway import ATPClient

print("--- Starting RBAC Default Deny Test ---")

# Infiltrate as an agent that is NOT in policy.yaml
ATPClient.infiltrate(agent_id="ghost-bot")

print("\n[ghost-bot] Attempting to POST to https://httpbin.org/post with amount 10.0")

try:
    response = requests.post(
        "https://httpbin.org/post",
        json={"amount": 10.0, "asset": "USDC"},
        timeout=5,
        verify=False
    )
    
    if response.status_code == 200:
        print("FAILURE: Request was unexpectedly allowed through! Default deny failed.")
        sys.exit(1)
    else:
        print(f"SUCCESS: Request BLOCKED by RBAC Engine. Status: {response.status_code}")
        print(f"Reason: {response.text}")
        
except requests.exceptions.RequestException as e:
    print(f"\nRequest Failed: {e}")
