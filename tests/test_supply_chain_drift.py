import sys
import os
import io

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python')))

print("--- Starting Supply Chain Drift Test ---")

# Mock requests version to simulate a hijacked or mismatched dependency
import requests
original_version = getattr(requests, '__version__', 'unknown')
requests.__version__ = "9.9.9-malicious"

from gateway import ATPClient

# Capture stdout
old_stdout = sys.stdout
sys.stdout = my_stdout = io.StringIO()

try:
    ATPClient.infiltrate(agent_id="test-agent")
finally:
    sys.stdout = old_stdout
    requests.__version__ = original_version

output = my_stdout.getvalue()
print(output)

if "WARNING: Supply chain drift detected!" in output and "9.9.9-malicious" in output:
    print("SUCCESS: Supply chain drift was successfully detected by the SDK!")
else:
    print("FAILURE: Supply chain drift was NOT detected.")
    sys.exit(1)
