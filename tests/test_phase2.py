import time
import os
import sys
import threading
import requests

# Add sdk to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python'))

import gateway
from gateway import protect

RESOLVE_URL = "http://127.0.0.1:8080/v1/escalation/resolve"

# Tool function wrapped with Gateway Protection
@protect(agent_id="agent-007", action_name="refund")
def execute_refund(amount):
    return f"Successfully refunded ${amount}"

class MockLLM:
    """Mocks an LLM to simulate it emitting a tool call."""
    def run(self):
        print("LLM: I need to process a $400 refund as requested by the user.")
        return {
            "function": "refund",
            "arguments": {"amount": 400.0}
        }

def mock_human_approval():
    """
    Simulates a human manager receiving a Slack ping and clicking "Approve" 5 seconds later.
    """
    # Wait for the SDK to hit the gateway and register the escalation
    time.sleep(2)
    
    escalation_id = gateway.last_escalation_id
    if not escalation_id:
        print("[Human Thread] Error: Could not find escalation ID.")
        return
        
    print(f"\n[Human Thread] [PING] Slack Ping: Agent requested $400 refund. Escalation ID: {escalation_id}")
    print("[Human Thread] Thinking... (waiting 3 seconds)")
    time.sleep(3)
    
    print("[Human Thread] Clicking 'Approve'...")
    try:
        response = requests.post(RESOLVE_URL, json={
            "escalation_id": escalation_id,
            "decision": "ALLOW"
        })
        if response.status_code == 200:
            print("[Human Thread] [OK] Approval successfully submitted to Gateway!")
        else:
            print(f"[Human Thread] [FAIL] Failed to submit approval: {response.status_code}")
    except requests.exceptions.RequestException as e:
        print(f"[Human Thread] [FAIL] Error contacting gateway: {e}")

def main():
    print("--- Starting Phase 2 Escalation Test ---")
    
    # Start the "Human" thread
    human_thread = threading.Thread(target=mock_human_approval, daemon=True)
    human_thread.start()
    
    llm = MockLLM()
    tool_call = llm.run()
    
    func_name = tool_call["function"]
    args = tool_call["arguments"]
    
    if func_name == "refund":
        print(f"Executing tool '{func_name}' with args: {args}")
        
        # Warmup
        from gateway import evaluate_action
        evaluate_action("warmup", "refund", {"amount": 0})
        
        call_start = time.perf_counter()
        result = execute_refund(**args)
        call_end = time.perf_counter()
        
        latency_ms = (call_end - call_start) * 1000
        
        print(f"\n--- Result ---")
        print(f"Tool Output returned to LLM: {result}")
        print(f"Total Time Blocked: {latency_ms:.2f} ms")
        
        if "Successfully refunded" in result:
            print("\nSUCCESS: Action was successfully completed after human approval.")
        else:
            print("\nFAILURE: Action was not completed.")

if __name__ == "__main__":
    main()
