import sys
import os
import requests
import urllib3
import time

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python')))
from gateway import ATPClient

print("--- Starting Circuit Breaker Anomaly Test ---")
ATPClient.infiltrate(agent_id="bot-omega")

print("\n[Phase A] Firing 6 rapid requests to trigger velocity anomaly...")
success_count = 0
for i in range(6):
    try:
        resp = requests.post(
            "http://127.0.0.1:5173",
            json={"action": "transfer", "amount": 1.0, "asset": "USDC"},
            timeout=5,
            verify=False
        )
        if resp.status_code == 200:
            success_count += 1
            print(f"Request {i+1} ALLOWED")
        else:
            print(f"Request {i+1} BLOCKED: {resp.text.strip()}")
    except Exception as e:
        print(f"Request {i+1} FAILED: {e}")

print(f"\n[Phase B] Attempting a 7th request. The agent should be suspended (Circuit Breaker OPEN)...")
try:
    resp = requests.post("http://127.0.0.1:5173", json={"action": "transfer", "amount": 1.0, "asset": "USDC"}, timeout=5, verify=False)
    if resp.status_code == 200:
        print("FAILURE: Request allowed! Circuit breaker failed to suspend agent.")
        sys.exit(1)
    elif "Circuit Breaker OPEN" in resp.text:
        print(f"SUCCESS: Agent is suspended. Status: {resp.status_code}")
        print(f"Reason: {resp.text.strip()}")
    else:
        print(f"Unexpected block reason: {resp.text}")
except Exception as e:
    print(f"FAILED: {e}")
