import time
import os
import sys
import random
import threading

# Add sdk to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python'))

from gateway import evaluate_action

AGENTS = ["agent-alpha", "agent-beta", "agent-gamma", "agent-delta"]

def fire_random_request():
    agent = random.choice(AGENTS)
    amount = random.choice([50, 100, 250, 350, 450, 550, 800, 1200])
    
    print(f"[{agent}] Requesting refund of ${amount}...")
    # We bypass the decorator here and directly spam the gateway API
    # to simulate multiple agents running concurrently and hitting the engine.
    evaluate_action(agent, "refund", {"amount": amount})

def main():
    print("--- Starting Phase 3 Spam Test ---")
    print("Firing 50 rapid requests to populate the dashboard...")
    
    threads = []
    for _ in range(50):
        t = threading.Thread(target=fire_random_request)
        threads.append(t)
        t.start()
        time.sleep(random.uniform(0.05, 0.2)) # rapid fire
        
    for t in threads:
        t.join()
        
    print("Spam complete!")

if __name__ == "__main__":
    main()
