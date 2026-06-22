import sys
import os
import requests
import time

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python')))
from gateway import ATPClient

print("--- Starting Global Kill Switch Test ---")

KILLSWITCH_URL = "http://127.0.0.1:8081/v1/killswitch"

# Ensure kill switch is OFF
requests.post(KILLSWITCH_URL, json={"active": False})

ATPClient.infiltrate(agent_id="bot-omega")

# Step 1: Normal request
print("\n[Phase A] Requesting with Kill Switch OFF...")
try:
    resp = requests.post("https://httpbin.org/post", json={"amount": 10.0, "asset": "USDC"}, timeout=3, verify=False)
    if resp.status_code == 200:
        print("SUCCESS: Request went through.")
    else:
        print(f"FAILED: Unexpected status {resp.status_code} - {resp.text}")
except Exception as e:
    print(f"Error: {e}")

# Step 2: Activate Kill Switch
print("\n[Phase B] Activating Global Kill Switch...")
requests.post(KILLSWITCH_URL, json={"active": True})

# Step 3: Attempt request
print("Requesting with Kill Switch ON...")
try:
    resp = requests.post("https://httpbin.org/post", json={"amount": 10.0, "asset": "USDC"}, timeout=3, verify=False)
    if resp.status_code == 503 and "Global Kill Switch is ACTIVE" in resp.text:
        print("SUCCESS: Traffic successfully severed by Kill Switch!")
    else:
        print(f"FAILURE: Traffic went through! {resp.status_code}")
        sys.exit(1)
except Exception as e:
    print(f"Error: {e}")

# Reset Kill Switch
requests.post(KILLSWITCH_URL, json={"active": False})
