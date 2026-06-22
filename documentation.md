# Agentic App Gateway (ATP): Comprehensive Documentation

## 1. Executive Summary
The **Attested Layer 7 Transparent Proxy (ATP)** is an enterprise-grade, zero-trust control plane designed specifically to govern autonomous AI agents. It acts as an impenetrable shield between AI models and the external internet. By taking complete control over the transport layer (HTTP/HTTPS) through a Man-in-the-Middle (MITM) proxy, ATP guarantees absolute compliance, Data Loss Prevention (DLP), behavioral anomaly detection, and cryptographic auditability—all without requiring developers to rewrite their AI agents' core logic.

## 2. The Problem It Solves
As AI agents move from read-only assistants to autonomous actors capable of making financial transactions, modifying databases, and writing code, the attack surface expands exponentially. Traditional API gateways and Web Application Firewalls (WAFs) are designed to protect web servers from *inbound* malicious traffic. However, autonomous agents present a completely different threat model:

*   **Excessive Agency:** Agents acting on vaguely defined instructions may execute actions (e.g., mass deletions, large fund transfers) that were never intended by the operator.
*   **Indirect Prompt Injection:** An agent may read a seemingly benign external webpage or document that contains hidden adversarial instructions, successfully hijacking the agent's next actions.
*   **Supply Chain Attacks:** Attackers poison the open-source libraries (e.g., PyPI) that the agents rely on. When the agent spins up, the hijacked dependency acts on the agent's behalf using its credentials.
*   **Lack of Cryptographic Auditability:** Traditional logs can be edited or deleted by compromised admins or attackers covering their tracks.
*   **Cascading Failures:** A single malfunctioning or hijacked agent can rapidly spam external APIs, draining budgets or triggering rate-limit bans across an entire organization.

The ATP Gateway solves these problems structurally. Rather than trying to parse the "intent" of an LLM via unreliable semantic classifiers, it enforces strict network boundaries, tracks data provenance (taint tracking), and cryptographically seals every action an agent takes.

## 3. Importance and Business Value
Deploying autonomous agents in production carries severe financial, reputational, and regulatory risks. ATP is critical because it:
1.  **Enables Production-Ready AI:** It allows enterprises to confidently deploy autonomous AI to automate workflows, knowing there is a hard, physical safety net in place.
2.  **Satisfies Compliance and Auditing:** By mapping directly to frameworks like OWASP LLM Top 10, NIST AI RMF, and ISO 42001, ATP satisfies enterprise security reviews.
3.  **Prevents Irreversible Damage:** With its capability-based RBAC and reversibility classifications, it physically stops irreversible actions (like database deletions or large wire transfers) unless explicitly approved by a human.
4.  **Zero-Touch Integration:** It does not force teams to learn a new AI framework. By patching the network layer natively (in Python, Node.js, and Go), developers can use LangChain, CrewAI, or raw scripts seamlessly.

---

## 4. Deep Dive: Core Features and Architecture

The ATP system represents the culmination of a 9-phase hardening process, transitioning from a simple transport proxy into a full-spectrum agentic control plane.

### 4.1 Fail-Closed Enforcement & Multi-Runtime Coverage
Agents are executed inside isolated Docker network namespaces (`proxy-net`). They have absolutely no direct route to the internet. If the ATP Go Engine crashes, the agent loses internet access rather than failing open. 
*   **Multi-Runtime:** Native SDK shims exist for Python (`requests`/`urllib3`), Node.js (`https.Agent`), and Go (`http.Transport`) to automatically route traffic to the proxy and trust the local CA.

### 4.2 Capability-Based Policy Engine (Default-Deny RBAC)
ATP evaluates all outbound traffic against a strict default-deny policy. An agent's identity dictates its role, and that role grants explicit capabilities (e.g., `payments:refund`). If an agent attempts an action outside its granted scope, it is blocked at the network layer, regardless of the financial amount involved.

### 4.3 Bidirectional Inspection & Taint Tracking
This is ATP's primary defense against **Indirect Prompt Injection**. The proxy inspects inbound responses. If an agent ingests untrusted data from the open web, the proxy instantly labels that agent's session as "tainted." If the tainted agent subsequently attempts a high-stakes action, its capabilities are dynamically downgraded, and the request is forcibly frozen for Human-in-the-Loop (HITL) review—preventing hijacked agents from causing damage.

### 4.4 Supply Chain Integrity Layer
To combat poisoned dependencies, the platform enforces strict cryptographic hash pinning for all installations (e.g., `pip install --require-hashes`). Furthermore, CI/CD pipelines generate CycloneDX Software Bill of Materials (SBOM) manifests using tools like `syft`, ensuring that exactly what was audited is what is running in production.

### 4.5 Behavioral Anomaly Detection & Circuit Breakers
The proxy maintains a rolling statistical baseline of request velocity per agent. If an agent begins spamming the network (e.g., a burst of 6 requests in 10 seconds), a State-Machine Circuit Breaker trips. The agent is immediately and dynamically suspended from the network, preventing cascading failures.

### 4.6 Tamper-Evident Attestation Chain (CORAL)
Every single request that passes through the gateway is bundled into a canonical string (`Method + URL + Body + Timestamp`). The Go engine generates an Ed25519 cryptographic signature for this string. Furthermore, the audit logs (`telemetry.jsonl`) are hash-chained: each log entry contains the SHA-256 hash of the *previous* log entry. Any post-facto tampering, deletion, or modification of the logs breaks the chain, mathematically proving tampering occurred.

### 4.7 Reversibility Classification & Global Kill Switch
Actions are classified not just by cost, but by reversibility. A $10 deletion may be irreversible, while a $500 refund is reversible. Irreversible actions are configured to *always* require human escalation. 
Additionally, the platform features a "Global Kill Switch." When activated, all agent network namespaces are instantly severed simultaneously, providing a hard panic button for administrators.

### 4.8 Governance & Compliance Mapping
ATP is designed to answer the demands of enterprise security reviewers. The controls built into ATP map directly to:
*   **OWASP LLM Top 10:** Prevents Excessive Agency (LLM08), Prompt Injection (LLM01), and Supply Chain Vulnerabilities (LLM05).
*   **NIST AI RMF:** Fulfills Govern, Map, Measure, and Manage functions.
*   **ISO 42001:** Satisfies clauses regarding impact assessments and automated system oversight.

### 4.9 Red-Team Validation Harness
Security is proven through adversarial testing. The project includes a dedicated `test_redteam` suite that executes chaos testing (killing the engine mid-flight), supply chain drift simulations, and prompt-smuggling JSON injection attempts. ATP is mathematically proven to fail-closed under these conditions.

---

## 5. The Sahara Command Center Dashboard
All backend telemetry and control features are exposed via the **Sahara Command Center**, a high-performance React/Vite dashboard:
*   **Live Attested Stream:** A real-time WebSocket feed of every agent action, complete with cryptographic signature verification.
*   **Interactive Inbox:** Administrators can manually Approve or Deny agent actions that have been paused via HITL escalation.
*   **Supply Chain Monitor:** Displays the real-time verified status of the agent's pinned dependencies.
*   **Audit Chain Verifier:** A one-click utility that iterates through the entire hash-chained log to verify cryptographic integrity.
*   **Global Kill Switch UI:** A prominent, confirmation-gated interface to drop all network traffic globally in an emergency.
