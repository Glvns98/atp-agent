import time
import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python'))
from gateway import protect

@protect(agent_id="agent-human-test", action_name="refund")
def execute_refund(amount):
    return f"Successfully refunded ${amount}"

def main():
    print("--- Starting Phase 4 Interactive Test ---")
    print("Agent requesting a $400 refund.")
    print("WARNING: This script will hang until YOU click 'Approve' or 'Deny' on the Dashboard UI!")
    
    # We will trigger the escalate state and wait indefinitely until the UI is clicked.
    result = execute_refund(amount=400.0)
    
    print("\n--- Result ---")
    print(f"Tool Output returned to LLM: {result}")

if __name__ == "__main__":
    main()
