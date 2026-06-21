# ATP Guardrail System 🛡️

The **Attested Transport Protocol (ATP)** is an open-source, mathematically secure Guardrail system for AI Agents. It intercepts, evaluates, and cryptographically signs every action your AI Agent takes (LLM calls, HTTP requests, File I/O) before it happens.

This repository contains the complete SDK and runtime.

## Installation

### For AI Developers (Python SDK)
Install the core SDK and CLI via PyPI:
```bash
pip install atp-core
```

**Usage:**
1. **Start the Engine:** Run `atp start` in your terminal. This downloads and runs the local ATP MITM proxy in the background.
2. **Instrument your Agent:**
```python
from atp_core import ATPClient

client = ATPClient(tenant_id="YOUR_KEY")
client.intercept_all() # All outgoing requests are now guarded by ATP
```
3. **Verify Compliance Reports:** Run `atp verify report.md` to mathematically prove the integrity of an agent's audit log.

### For Security & Compliance Teams (Enterprise Portal)
If you do not write Python, but need to audit AI agents or view live cryptographic telemetry streams, you can run the Enterprise Portal from any machine:

```bash
npx atp-portal
```
This will launch the Sahara Dark Theme UI on `localhost:5173`. You can securely authenticate with your Tenant API Key to monitor your agents globally, or use the Independent Auditor Portal without logging in to drop and verify `.md` Compliance Certificates.

## Architecture
- **Go Engine**: A blazing fast, multi-platform proxy (`engine/`) that enforces RBAC and hashes traffic.
- **Python SDK**: A minimal wrapper (`sdk/python`) to seamlessly hook AI agents.
- **Enterprise Portal**: A secure React dashboard (`platform/`) for real-time visualization and auditing.
