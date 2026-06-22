import sys
import os
import requests

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python')))
from gateway import ATPClient

print("--- Starting HITL Timeout Denies Test ---")

# Step 1: Infiltrate
ATPClient.infiltrate(agent_id="bot-omega")

print("\n[bot-omega] Attempting to POST to https://httpbin.org/post with amount 999.0")
print("This triggers an escalation. We will NOT approve it, and wait for the engine to time it out.")

# Note: The proxy times out escalations after 30 seconds.
# We set timeout=35 so our client waits long enough for the engine to deny it.
try:
    response = requests.post(
        "https://httpbin.org/post",
        json={"action": "refund", "amount": 999.0, "asset": "USDC"},
        timeout=35,
        verify=False
    )
    
    if response.status_code == 200:
        print("FAILURE: Request was unexpectedly allowed through! Timeout deny failed.")
        sys.exit(1)
    else:
        print(f"SUCCESS: Request BLOCKED by Engine due to Timeout. Status: {response.status_code}")
        print(f"Reason: {response.text}")
        if "Escalation Timed Out" in response.text:
            print("Verified: Proper timeout message received.")
        
except requests.exceptions.RequestException as e:
    print(f"\nRequest Failed unexpectedly: {e}")
    sys.exit(1)
