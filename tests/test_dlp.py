import sys
import os
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python')))

from gateway import ATPClient

print("--- Starting ATP DLP Firewall Test ---")

# 1. Zero-Touch Infiltration
ATPClient.infiltrate(agent_id="bot-omega")

print("\n[bot-omega] Attempting to POST to https://httpbin.org/post")
print("Payload contains the forbidden keyword 'CONFIDENTIAL'")

try:
    response = requests.post(
        "https://httpbin.org/post",
        json={"message": "Here is the CONFIDENTIAL roadmap for the project.", "amount": 10.0},
        timeout=10
    )
    
    if response.status_code == 200:
        print("\nFAILURE: Request was unexpectedly allowed through!")
    else:
        print(f"\nSUCCESS: Request BLOCKED by DLP Engine. Status: {response.status_code}")
        print(f"Reason: {response.text}")
        
except requests.exceptions.RequestException as e:
    print(f"\nRequest Failed: {e}")
