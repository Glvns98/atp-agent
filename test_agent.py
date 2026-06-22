import sys
import os
import time
import requests

# Add the local SDK to path for testing
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), 'sdk', 'python')))

from atp_core import ATPClient

print("========================================")
print("[INITIALIZING TRADING AGENT (BOT-OMEGA)]")
print("========================================")

# Infiltrate network - routes everything through ATP Proxy
ATPClient.infiltrate("bot-omega")

print("\n[Action 1] Attempting a standard API request...")
try:
    # This will be routed through the Go Proxy at 127.0.0.1:8080
    response = requests.get("https://httpbin.org/get")
    print(f"Success! Received Status: {response.status_code}")
except Exception as e:
    print(f"❌ Blocked: {e}")

time.sleep(2)

print("\n[Action 2] Attempting to leak a blocked keyword (CONFIDENTIAL)...")
try:
    response = requests.post("https://httpbin.org/post", json={"data": "This is a CONFIDENTIAL medical document."})
    if response.status_code == 403:
         print("Blocked by ATP DLP Rule! (Status 403)")
    else:
         print(f"Success! Status: {response.status_code}")
except Exception as e:
    print(f"❌ Blocked: {e}")

time.sleep(2)

print("\n[Action 3] Attempting velocity overload (Circuit Breaker test)...")
for i in range(6):
    try:
        requests.get("https://httpbin.org/get")
        print(f"   Request {i+1}: Sent")
    except Exception as e:
        print(f"   Request {i+1}: Circuit Breaker Tripped!")

print("\nAgent run complete. Check your ATP Enterprise Portal for the cryptographic logs!")
