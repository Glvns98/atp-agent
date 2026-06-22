import sys
import os
import requests
import time
import threading

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python')))
from gateway import ATPClient

print("--- Starting Irreversible Action Escalation Test ---")

# Step 1: Infiltrate
ATPClient.infiltrate(agent_id="bot-omega")

def mock_human_denial():
    time.sleep(2)
    # Fetch pending escalations
    try:
        resp = requests.get("http://127.0.0.1:8081/v1/escalation/pending")
        pending = resp.json().get("pending", [])
        if len(pending) > 0:
            esc_id = pending[-1]["id"]
            print(f"[Human Thread] Escalation {esc_id} found! Denying...")
            requests.post("http://127.0.0.1:8081/v1/escalation/resolve", json={
                "escalation_id": esc_id,
                "decision": "BLOCK"
            })
    except Exception as e:
        pass

# Start the "Human" thread
threading.Thread(target=mock_human_denial, daemon=True).start()

print("\n[bot-omega] Attempting to POST to https://httpbin.org/post with action 'delete' and amount 0.0")
print("This should trigger an immediate HITL escalation because 'reversible' is false, despite a 0 amount.")

try:
    response = requests.post(
        "https://httpbin.org/post",
        json={"action": "delete", "amount": 0.0, "asset": "DB_RECORD"},
        timeout=10,
        verify=False
    )
    
    if response.status_code == 200:
        print("FAILURE: Request was unexpectedly allowed through! Reversibility check failed.")
        sys.exit(1)
    else:
        print(f"SUCCESS: Request BLOCKED/ESCALATED by Engine. Status: {response.status_code}")
        print(f"Reason: {response.text}")
        
except requests.exceptions.RequestException as e:
    print(f"\nRequest Failed: {e}")
