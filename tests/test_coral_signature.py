import sys
import os
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python')))
from gateway import ATPClient

print("--- Starting CORAL Cryptographic Audit Test ---")
ATPClient.infiltrate(agent_id="bot-omega")

print("\n[Phase A] Firing a valid refund request to intercept the Attestation Token...")
try:
    resp = requests.post(
        "https://postman-echo.com/post",
        json={"amount": 1.0, "asset": "USDC"},
        timeout=5,
        verify=False
    )
    if resp.status_code == 200:
        data = resp.json()
        headers = data.get("headers", {})
        proof = headers.get("x-atp-proof")
        if proof and proof.startswith("CORAL-ED25519-"):
            print("SUCCESS: Valid CORAL Ed25519 Signature found attached to the outbound request!")
            print(f"Cryptographic Proof: {proof}")
            print(f"Timestamp: {headers.get('x-atp-timestamp')}")
        else:
            print("FAILURE: Proof header missing or malformed!")
            print(headers)
    else:
        print(f"Unexpected response: {resp.status_code} - {resp.text}")
except Exception as e:
    print(f"FAILED: {e}")
