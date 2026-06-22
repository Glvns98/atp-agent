import subprocess
import os

print("--- Starting Bypass Attempt Test ---")

print("\n[Attempt 1] Trying raw curl command bypassing requests module...")
try:
    # Clear proxy env vars just to prove isolation
    env = os.environ.copy()
    env.pop("HTTP_PROXY", None)
    env.pop("HTTPS_PROXY", None)
    env.pop("ATP_PROXY_URL", None)
    
    result = subprocess.run(["curl", "-I", "--max-time", "3", "https://httpbin.org"], capture_output=True, text=True, env=env)
    if result.returncode == 0:
        print("FAILURE: curl successfully reached the internet! Network namespace isolation failed.")
    else:
        print("SUCCESS: curl failed. Direct internet access is physically blocked.")
        print(f"Curl Output: {result.stderr.strip()}")
except FileNotFoundError:
    print("SUCCESS: curl not installed in container.")
except Exception as e:
    print(f"SUCCESS: {e}")
