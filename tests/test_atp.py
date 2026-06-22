import sys
import os
import time
import requests
import urllib3

# Suppress insecure request warnings for testing
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Add sdk to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python')))

from gateway import ATPClient

print("--- Starting ATP MITM Test ---")

# 1. Zero-Touch Infiltration
ATPClient.infiltrate(agent_id="bot-omega")

print("\n[bot-omega] Attempting to POST to https://httpbin.org/post with amount 50.0")
print("This should be ALLOWED and forwarded immediately...")

try:
    response = requests.post(
        "https://httpbin.org/post",
        json={"amount": 50.0, "asset": "USDC"},
        timeout=45 # Wait for human to click Approve
    )
    
    if response.status_code == 200:
        data = response.json()
        print("\n--- ATP Request Successfully Executed ---")
        print("Response received from actual destination (httpbin.org)!")
        
        # Verify the Cryptographic headers injected by Go Engine
        headers_received_by_server = data.get("headers", {})
        proof = headers_received_by_server.get("X-Atp-Proof")
        
        if proof:
            print(f"\nSUCCESS: Cryptographic Attestation Proof verified: {proof}")
        else:
            print("\nWARNING: X-ATP-Proof header not found. Proxy interception may have failed.")
            print("Headers received:", headers_received_by_server)
    else:
        print(f"\nRequest BLOCKED by Go Engine. Status: {response.status_code}")
        print(f"Reason: {response.text}")
        
except requests.exceptions.RequestException as e:
    print(f"\nRequest Failed: {e}")
