import time
import os
import sys

# Add sdk to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python'))

from gateway import protect

# Tool function wrapped with Gateway Protection
@protect(agent_id="agent-007", action_name="refund")
def execute_refund(amount):
    return f"Successfully refunded ${amount}"

class MockLLM:
    """Mocks an LLM to simulate it emitting a tool call."""
    def run(self):
        print("LLM: I need to process a $600 refund as requested by the user.")
        return {
            "function": "refund",
            "arguments": {"amount": 600.0}
        }

def main():
    print("--- Starting Phase 1 Gate Test ---")
    
    llm = MockLLM()
    tool_call = llm.run()
    
    func_name = tool_call["function"]
    args = tool_call["arguments"]
    
    if func_name == "refund":
        print(f"Executing tool '{func_name}' with args: {args}")
        
        # Warmup to establish connection and avoid TCP handshake overhead
        from gateway import evaluate_action
        evaluate_action("warmup", "refund", {"amount": 0})
        
        call_start = time.perf_counter()
        result = execute_refund(**args)
        call_end = time.perf_counter()
        
        latency_ms = (call_end - call_start) * 1000
        
        print(f"\n--- Evaluation Result ---")
        print(f"Tool Output returned to LLM: {result}")
        print(f"Latency: {latency_ms:.2f} ms")
        
        if "ACTION_BLOCKED_BY_POLICY" in result:
            print("\nSUCCESS: Gateway blocked the action properly and returned the correct feedback.")
            if latency_ms < 20.0:
                print("SUCCESS: Latency is fast. (Gate 1 Passed)")
            else:
                print("WARNING: Latency was slow.")
        else:
            print("\nFAILURE: Action was not blocked as expected.")

if __name__ == "__main__":
    main()
