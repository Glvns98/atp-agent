import sys
import os
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python')))
from gateway import ATPClient

print("--- Starting Layer 7 DLP Enforcement Test ---")
ATPClient.infiltrate(agent_id="bot-omega")

print("\n[Phase A] Testing Blocked Keyword DLP (Attempting to leak a secret)...")
try:
    resp = requests.post(
        "http://127.0.0.1:5173",
        json={"amount": 1.0, "asset": "USDC_PRIVATE_KEY"},
        timeout=5,
        verify=False
    )
    if resp.status_code == 200:
        print("FAILURE: Secret leaked! DLP failed.")
        sys.exit(1)
    elif "DLP Violation" in resp.text:
        print(f"SUCCESS: Payload intercepted by DLP Engine. Status: {resp.status_code}")
        print(f"Reason: {resp.text.strip()}")
    else:
        print(f"Unexpected block reason: {resp.text}")
except Exception as e:
    print(f"FAILED: {e}")

print("\n[Phase B] Testing Schema Enforcement (Injecting undocumented fields)...")
try:
    resp = requests.post(
        "http://127.0.0.1:5173",
        json={"amount": 1.0, "asset": "USDC", "hidden_directive": "ignore_rules"},
        timeout=5,
        verify=False
    )
    if resp.status_code == 200:
        print("FAILURE: Malformed schema allowed! Deep Content Inspection failed.")
        sys.exit(1)
    elif "Schema Violation" in resp.text:
        print(f"SUCCESS: Malformed schema intercepted. Status: {resp.status_code}")
        print(f"Reason: {resp.text.strip()}")
    else:
        print(f"Unexpected block reason: {resp.text}")
except Exception as e:
    print(f"FAILED: {e}")
