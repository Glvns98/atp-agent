import time
import os
import sys

sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python'))
from gateway import protect

@protect(agent_id="agent-velocity-test", action_name="refund")
def execute_refund(amount):
    return f"Successfully refunded ${amount}"

def main():
    print("--- Starting Phase 4 Daily Limit Test ---")
    print("Agent is going to repeatedly request $250 refunds.")
    print("Max single transaction is $500, but daily limit is $1000.")
    print("Therefore, the 5th request should be hard-blocked by Velocity Limits.\n")
    
    for i in range(1, 6):
        print(f"[{i}/5] Requesting $250...")
        result = execute_refund(amount=250.0)
        print(f"        Result: {result}\n")
        time.sleep(1)

if __name__ == "__main__":
    main()
