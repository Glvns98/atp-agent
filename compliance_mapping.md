# Governance & Compliance Mapping

Engineering controls are mapped directly to enterprise compliance frameworks.

| ATP Control | OWASP LLM Top 10 (2026) | NIST AI RMF | ISO 42001 |
|---|---|---|---|
| Phase 2 — RBAC default-deny | Excessive Agency | Govern 1.1, Manage 2.1 | Clause 8.2 |
| Phase 3 — Taint tracking | Prompt Injection (direct/indirect) | Map 1.1, Measure 2.3 | Clause 6.1 |
| Phase 4 — SBOM/supply chain | Supply Chain Vulnerabilities | Govern 4.1 | Clause 8.1 |
| Phase 6 — Attestation chain | Insecure Output Handling, audit gaps | Measure 4.2 | Clause 9.1 |
| Phase 7 — Kill switch / reversibility | Excessive Agency | Manage 1.3 | Clause 8.3 |
