import json
import time
import requests
import functools

GATEWAY_URL = "http://127.0.0.1:8080/v1/evaluate"
STATUS_URL = "http://127.0.0.1:8080/v1/escalation/status"
session = requests.Session()
last_escalation_id = None

def evaluate_action(agent_id, action, arguments):
    """
    Calls the Go engine to evaluate if an action should be allowed.
    """
    payload = {
        "agent_id": agent_id,
        "action": action,
        "arguments": arguments
    }
    
    try:
        response = session.post(GATEWAY_URL, json=payload, timeout=0.1) 
        if response.status_code == 200:
            return response.json()
        else:
            return {"status": "BLOCK", "reason": f"Gateway error: {response.status_code}"}
    except requests.exceptions.RequestException as e:
        return {"status": "BLOCK", "reason": f"Gateway unreachable: {e}"}

def poll_escalation(escalation_id, timeout_seconds=30):
    """
    Polls the Gateway for the status of an escalation.
    Returns the final status (ALLOW or BLOCK).
    If it times out, defaults to BLOCK.
    """
    start_time = time.time()
    print(f"[{time.strftime('%X')}] [WARN] Action escalated. Pausing agent and awaiting manual approval (ID: {escalation_id})...")
    
    while True:
        if time.time() - start_time > timeout_seconds:
            print(f"[{time.strftime('%X')}] [FAIL] Escalation timed out after {timeout_seconds}s. Defaulting to BLOCK.")
            return "BLOCK"
            
        try:
            response = session.get(f"{STATUS_URL}?id={escalation_id}", timeout=1.0)
            if response.status_code == 200:
                data = response.json()
                state = data.get("status")
                
                if state == "ALLOW":
                    print(f"[{time.strftime('%X')}] [OK] Escalation manually APPROVED! Resuming agent...")
                    return "ALLOW"
                elif state == "BLOCK":
                    print(f"[{time.strftime('%X')}] [FAIL] Escalation manually DENIED! Blocking action...")
                    return "BLOCK"
                # If PENDING, just continue polling
        except requests.exceptions.RequestException:
            pass # ignore temporary network errors while polling
            
        time.sleep(2) # poll every 2 seconds

def protect(agent_id, action_name):
    """
    Decorator for tool functions.
    Before executing the function, it checks with the Gateway.
    If blocked, returns the rejection message so the LLM is informed.
    If escalated, pauses the execution thread and polls for human input.
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            eval_res = evaluate_action(agent_id, action_name, kwargs)
            status = eval_res.get("status")
            
            if status == "ESCALATE":
                escalation_id = eval_res.get("escalation_id")
                
                # Expose for testing
                global last_escalation_id
                last_escalation_id = escalation_id
                
                final_status = poll_escalation(escalation_id, timeout_seconds=30)
                if final_status == "BLOCK":
                    return "ACTION_BLOCKED_BY_POLICY: Escalation was denied or timed out."
                # If ALLOW, fall through to function execution
            elif status == "BLOCK":
                reason = eval_res.get("reason", "ACTION_BLOCKED_BY_POLICY: Do not retry.")
                return reason
                
            return func(*args, **kwargs)
        return wrapper
    return decorator
