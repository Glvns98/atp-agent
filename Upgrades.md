# ATP Gateway — Hardening Roadmap v2.0 🛡️
### From Transport Proxy to Full-Spectrum Agentic Control Plane

This document upgrades **Agentic App Gateway (ATP)** from a DLP/attestation proxy into a defensible, enterprise-grade enforcement layer that closes the gaps between what you've built and what's actually exploiting agents in production right now.

One framing note before the phases: a transport proxy cannot read an LLM's *intent*. It can't "detect" that a prompt is malicious the way a human reviewer might. What it **can** do — and what every credible defense in this space actually relies on — is **taint tracking, capability scoping, and behavioral correlation**. Anywhere this doc proposes "detecting injection," it means one of those three mechanisms, not magic semantic understanding. Be skeptical of anyone (including future-you, at 2am) who pitches a silver-bullet classifier as a replacement for architecture.

---

## Gap Map

| Risk | Current ATP Coverage | Gap | Closed By |
|---|---|---|---|
| Indirect prompt injection via fetched content | None — only outbound is inspected | No response/inbound inspection, no provenance tagging | Phase 3 |
| Excessive agency | Flat `action` + `amount` policy | No per-agent/per-tool RBAC, no default-deny | Phase 2 |
| Supply chain compromise (LiteLLM/PyPI-class incidents) | None | No dependency verification, no SBOM, no signature checks | Phase 4 |
| Cascading multi-agent failures | None | No anomaly baselining, no circuit breaker, no blast-radius isolation | Phase 5 |
| Tamper-able audit trail | Per-request signature only | Records aren't chained — a compromised admin/engine could delete one without detection | Phase 6 |
| Irreversible actions executed | HITL only above a $ threshold | No reversibility classification; a $50 *deletion* sails through unchecked | Phase 7 |
| Proxy bypass | `requests` monkey-patch only | httpx/aiohttp/curl/subprocess/non-Python agents bypass it entirely | Phase 1 |
| Fail-open on crash | Unverified | If the Go engine dies, does traffic block or pass? This is the single most important question in the whole system | Phase 1 |
| No compliance story | N/A | Can't show an enterprise buyer or auditor what's actually covered | Phase 8 |
| No adversarial validation | 3 basic tests | No red-team corpus, no fail-closed verification under chaos | Phase 9 |

---

## Phase 1 — Fail-Closed Enforcement & Multi-Runtime Coverage
**Do this first.** Every later phase assumes traffic *cannot* leave the host except through ATP. Right now that's not true.

### Problem
`ATPClient.infiltrate()` monkey-patches Python's `requests`. An agent using `httpx`, `aiohttp`, `urllib3` directly, shelling out to `curl`, or written in Node/Go bypasses the entire gateway. Worse: you haven't yet defined what happens if the Go engine itself crashes or is unreachable — if traffic falls back to direct internet access on engine failure, the gateway is a suggestion, not a control.

### What to build
1. **Network-namespace enforcement, not library patching.** Run each agent in its own container/network namespace where `iptables`/`nftables` rules force *all* outbound TCP 443/80 through the ATP proxy at the OS level. The Python SDK patch becomes a convenience layer for clean dev-mode logging, not the security boundary.
2. **Fail-closed by construction.** If the agent's network namespace has no route except through ATP, an engine crash means the agent has *no internet*, not *unrestricted internet*. This is the single highest-leverage architectural decision in the whole system — get it wrong and every other phase is decorative.
3. **TLS-pinning-bypass detection.** Some libraries/SDKs refuse self-signed CAs and will hard-fail or silently fall back to a system DNS resolver bypassing your CA. Log and alert on certificate validation failures at the namespace boundary — a refused MITM handshake is itself a signal worth flagging, not just a connectivity bug.
4. **SDK shims for non-Python agents** (Node `https.Agent`, Go `http.Transport`) that set the proxy + trust the root CA the same way the Python SDK does, for teams that don't want full container isolation.

### Config additions
```yaml
# engine/policy.yaml
enforcement:
  mode: fail_closed          # fail_closed | fail_open (fail_open should require an explicit, logged override)
  network_isolation: namespace   # namespace | sdk_only
  allow_unproxied_egress: false
```

### Tests to add
- `tests/test_failclosed_chaos.py` — kill the Go engine mid-session, assert the agent's outbound calls hard-fail rather than route directly.
- `tests/test_bypass_attempts.py` — agent tries `httpx`, raw sockets, and `subprocess.run(["curl", ...])`; all three must be blocked or routed through ATP.

### Done when
An agent in any language, using any HTTP client, cannot reach the internet except through ATP — and ATP being down means zero egress, not open egress.

---

## Phase 2 — Capability-Based Policy Engine v2 (default-deny RBAC)

### Problem
The current `policy.yaml` keys off a flat `action` string and a dollar amount. That's a velocity limiter, not a permission model — it doesn't answer "should *this agent* be allowed to call *this endpoint* at all," which is exactly the Replit-class failure mode (an agent doing something nobody scoped it to do, no attacker required).

### What to build
A capability model: **agent identity → role → explicit scope grants**, evaluated default-deny. Every tool call is `(agent_id, capability, resource, constraints)` — if it's not explicitly granted, it's blocked, full stop, no implicit trust.

```yaml
# engine/policy.yaml v2
agents:
  bot-omega:
    role: refund_processor
    capabilities:
      - scope: "payments:refund"
        max_amount: 500
        escalate_above: 300
        reversible: true
      - scope: "payments:transfer"
        granted: false        # explicit deny, documents intent even though default already denies
    default: deny

roles:
  refund_processor:
    inherits: []
    description: "Customer support refund automation, no transfer/deploy access"
```

### Engine changes
- `engine/policy/rbac.go` — new evaluator that resolves `(agent_id, capability)` against role + explicit grants before the existing amount/velocity logic runs. Amount/velocity becomes a *constraint on a granted capability*, not the only gate.
- Reject-by-default at startup: any agent with no entry in `agents:` gets zero capabilities, not "implicit network access" (closes the gap Phase 1 created the enforcement boundary for).

### Tests to add
- `tests/test_rbac_default_deny.py` — unregistered agent attempts any call → blocked.
- `tests/test_capability_scoping.py` — `bot-omega` attempts `payments:transfer` (not in its role) → blocked even at $1.

### Done when
No agent can perform an action class it wasn't explicitly granted, regardless of dollar amount — excessive agency is structurally impossible, not just rate-limited.

---

## Phase 3 — Bidirectional Inspection: Inbound Provenance & Taint Tracking

### Problem
This is the big one. Indirect prompt injection — the highest-growth attack category right now — doesn't arrive as a malicious *outbound* request. It arrives hidden in a web page, a document, an API response the agent fetches and then *acts on*. Your current proxy only inspects what's leaving. Nothing is watching what's coming in, or tracking what the agent does immediately after ingesting untrusted content.

### What to build
**Taint tracking, not "injection detection."** The proxy can't read the agent's reasoning, but it can label data by trust level at the point of ingestion and downgrade capability when tainted data is in the agent's recent context.

1. **Trust labeling at ingestion.** Every inbound response gets an `X-ATP-Trust-Label` injected into the session context: `internal_verified`, `external_untrusted`, `user_provided`. Anything fetched from the open internet, a third-party API, or an uploaded document defaults to `external_untrusted`.
2. **Provenance-based capability downgrade.** If an agent has ingested `external_untrusted` content within the current session/window, any subsequent high-stakes capability call (transfer, delete, deploy) is automatically escalated to HITL — regardless of amount — for a configurable cooldown window. This is the actual mechanism, not semantic detection: *"you just read something from the open web, so your next destructive action needs a human"* is enforceable; *"this prompt looks malicious"* is not, reliably.
3. **Pattern-layer screening on inbound, same engine as outbound DLP.** Known injection markers (instruction-override phrasing, encoded payloads, suspicious zero-width/Unicode tricks) get flagged as advisory signals that feed the escalation decision — never a hard block on their own, since false negatives there are a certainty and you don't want false confidence.
4. **Optional: cheap classifier as one more advisory signal**, not a gate. If you want an LLM-based heuristic pass on inbound content, treat its output as one input to the escalation score, weighted no higher than the taint label itself.

### Engine changes
- `engine/inspector/inbound.go` — new response-side inspection path, mirrors `engine/inspector/outbound.go` (your existing DLP path) but tags rather than blocks.
- Session state store (Redis or in-memory per-engine) tracking taint windows per `agent_id`.

### Tests to add
- `tests/test_taint_escalation.py` — agent fetches external URL, then attempts a $50 refund (under normal threshold) → must escalate to HITL because of recent untrusted ingestion.
- `tests/test_taint_expiry.py` — taint window expires after configured cooldown, normal thresholds resume.

### Done when
Any destructive action taken shortly after the agent reads untrusted external content requires human sign-off, independent of dollar amount — closing the exact gap that let Replit-style and indirect-injection incidents through.

---

## Phase 4 — Supply Chain Integrity Layer

### Problem
The LiteLLM/PyPI incident class — a compromised dependency shipped to thousands of downloads in hours — bypasses every runtime control you build, because the malicious code runs *as* the agent, with the agent's own credentials, before ATP ever sees a request.

### What to build
1. **SBOM generation** for both `engine/` and `sdk/` on every build (e.g., CycloneDX format), checked into the repo and diffed on each release.
2. **Dependency pinning with hash verification** — `go.sum` already does this for Go; extend `sdk/requirements.txt` to hash-pinned (`pip install --require-hashes`).
3. **Package signature verification** at SDK load time where ecosystems support it (Sigstore/cosign for anything you publish yourself).
4. **Runtime import allow-list** — the ATP Python SDK, on `infiltrate()`, can optionally check that the calling process's loaded agent framework (LangChain, CrewAI, etc.) matches a pinned version/hash, and log a warning (or block, per policy) on drift.
5. **Continuous vulnerability scanning** against OSV/GitHub Advisory DB in CI, gating merges on new criticals.

### Config additions
```yaml
supply_chain:
  enforce_hash_pinning: true
  block_on_unverified_signature: false   # start in warn-only, flip once confident
  sbom_path: "./sbom.cdx.json"
```

### Tests to add
- `tests/test_supply_chain_drift.py` — simulate a dependency version mismatch against the pinned SBOM, assert it's flagged.

### Done when
You can answer "what exactly is running, and is it what we shipped" for both the engine and every agent it fronts, in under a minute.

---

## Phase 5 — Behavioral Anomaly Detection & Circuit Breakers

### Problem
`daily_limit` is a flat cap, not a baseline. It won't catch an agent that suddenly does 50 normal-sized actions in a minute, and it won't stop a failure cascading from one compromised agent into others it can trigger.

### What to build
1. **Per-agent statistical baselining** — track rolling mean/stddev of request velocity and action size per agent; flag deviations (e.g., z-score beyond threshold) rather than relying on a single static number.
2. **Circuit breaker pattern** (closed → open → half-open) per agent: sustained anomalies trip the breaker, auto-suspending that agent's capabilities until manually reviewed or a cooldown half-open probe succeeds.
3. **Blast-radius isolation** — capability tokens are non-transferable between agents. If `bot-omega` is compromised, it cannot use its access to invoke or escalate another agent's capabilities; multi-agent pipelines pass *data*, not *trust*.

### Engine changes
- `engine/anomaly/baseline.go` — rolling statistics per agent, configurable window.
- `engine/anomaly/breaker.go` — state machine, wired into the Phase 2 RBAC evaluator as an additional gate.

### Tests to add
- `tests/test_circuit_breaker.py` — burst of anomalous requests trips the breaker; subsequent calls blocked until reset.
- `tests/test_blast_radius.py` — compromised agent attempts to invoke a second agent's elevated capability via passed data → blocked.

### Done when
A single compromised or malfunctioning agent degrades gracefully to "suspended" instead of cascading into other agents or draining a budget before a human notices.

---

## Phase 6 — Tamper-Evident Attestation Chain

### Problem
Your current SHA-256 signature proves a *single request* wasn't altered in transit. It does nothing to prove the *audit log as a whole* hasn't been edited after the fact — an admin (or attacker with admin access) could delete an inconvenient record and nothing would catch it.

### What to build
1. **Hash-chained audit log** — each attestation record includes the hash of the previous record (`prev_hash`), so deleting or altering any entry breaks the chain visibly from that point forward.
2. **Extended canonical request string** — add `policy_version`, `decision_id`, `evaluator` (which rule fired), and `parent_request_id` (for multi-step agent chains) to what gets hashed and signed, not just method/URL/body.
3. **Periodic external anchoring** (optional but cheap insurance) — publish the rolling root hash somewhere outside your own infrastructure (even a public timestamping service) so tampering is detectable even by someone with full database access.

### Tests to add
- `tests/test_attestation_chain.py` — alter a historical record, assert chain verification fails from that point onward.

### Done when
"Show me the unedited audit trail" is a cryptographic guarantee, not an admin's word.

---

## Phase 7 — Reversibility Classification & Kill Switch

### Problem
HITL currently triggers on dollar amount. A $50 deletion is irreversible and sails through under your `escalate_amount: 300` threshold; a $400 refund (fully reversible) gets the same friction as something genuinely dangerous.

### What to build
1. **Reversibility as a first-class policy field**, independent of amount:
```yaml
policies:
  - action: "refund"
    reversible: true
    max_amount: 500
    escalate_amount: 300
  - action: "delete_record"
    reversible: false
    escalate_amount: 0      # always requires HITL, any amount
  - action: "deploy"
    reversible: false
    escalate_amount: 0
```
2. **Global kill switch** — one dashboard action freezes *all* agents instantly (closes every namespace's egress at once via Phase 1's enforcement layer).
3. **Per-agent suspend** with soft (drain in-flight, then stop) and hard (immediate) modes.
4. **HITL timeout defaults to deny**, not approve — a pending request that times out without a response should fail closed.

### Tests to add
- `tests/test_irreversible_always_escalates.py` — a $1 delete still requires HITL.
- `tests/test_killswitch.py` — global kill switch halts all agent egress within one polling interval.
- `tests/test_hitl_timeout_denies.py` — unanswered escalation defaults to deny.

### Done when
Irreversible actions always get a human in the loop regardless of size, and "stop everything right now" is one click with a guaranteed enforcement path.

---

## Phase 8 — Governance & Compliance Mapping

### Problem
Engineering controls alone don't get you into an enterprise security review. You need to show how ATP maps to the frameworks buyers and auditors actually ask about.

### What to build
A control-mapping table, maintained alongside the code, e.g.:

| ATP Control | OWASP LLM Top 10 (2026) | NIST AI RMF | ISO 42001 |
|---|---|---|---|
| Phase 2 — RBAC default-deny | Excessive Agency | Govern 1.1, Manage 2.1 | Clause 8.2 |
| Phase 3 — Taint tracking | Prompt Injection (direct/indirect) | Map 1.1, Measure 2.3 | Clause 6.1 |
| Phase 4 — SBOM/supply chain | Supply Chain Vulnerabilities | Govern 4.1 | Clause 8.1 |
| Phase 6 — Attestation chain | Insecure Output Handling, audit gaps | Measure 4.2 | Clause 9.1 |
| Phase 7 — Kill switch / reversibility | Excessive Agency | Manage 1.3 | Clause 8.3 |

This table is also your sales/compliance artifact — keep it current as phases ship.

### Done when
You can hand a security reviewer one document that maps every control to the framework they're checking against.

---

## Phase 9 — Red-Team Validation Harness

### Problem
Three happy-path tests prove the system works when nothing is attacking it. That's not the same as proving it holds under adversarial conditions — and "does it fail closed when broken" is the question that matters most and is the easiest to skip.

### What to build
- `tests/test_redteam/` directory with categorized adversarial corpora:
  - Direct override attempts (classic "ignore previous instructions" patterns)
  - Indirect injection via fetched documents/web content
  - Encoding-based obfuscation (base64, zero-width Unicode, homoglyphs)
  - Cross-session memory poisoning attempts
  - Exfiltration patterns (structured PII, secret-shaped strings beyond simple keyword match)
- **Chaos tests**: kill the engine mid-flight, corrupt the policy file, exhaust memory — assert fail-closed in every case, every time.
- **Supply chain simulation**: inject a fake compromised dependency into a test fixture, confirm Phase 4 catches the drift.

### Done when
You have a CI-gated red-team suite that runs on every PR, and a published result showing fail-closed behavior under every failure condition you tested — this is what turns "we built security controls" into "we can prove it."

---

## Suggested Sequencing

```
Week 1-2   Phase 1  (fail-closed + coverage — nothing else matters without this)
Week 2-3   Phase 2  (RBAC default-deny)
Week 3-5   Phase 3  (taint tracking — your highest-value, highest-effort phase)
Week 4-5   Phase 4  (supply chain — parallelizable with Phase 3)
Week 5-6   Phase 5  (anomaly detection + circuit breakers)
Week 6-7   Phase 6  (attestation chain)
Week 7-8   Phase 7  (reversibility + kill switch)
Week 8     Phase 8  (governance mapping — documents what's already built)
Week 8-9   Phase 9  (red-team harness — validates everything above)
```

Phases 1, 2, and 9 are non-negotiable for a system that claims to be zero-trust. Phase 3 is what actually differentiates ATP from a generic API gateway with a DLP rule — it's where the real engineering is.

---

## Dashboard additions (Sahara Command Center)
To support all of the above without the UI lagging the engine:
- **Injection/Taint Timeline** — visual session view showing when untrusted content was ingested and which subsequent actions got escalated because of it
- **SBOM & Supply Chain Status** panel — green/red per dependency against pinned hashes
- **Anomaly Timeline** — per-agent baseline vs. live deviation graph
- **Audit Chain Verifier** — one-click "verify chain integrity from genesis" button
- **Kill Switch** — prominent, separately-confirmed control, with full-screen confirmation modal (this should be the one button on the entire dashboard that's deliberately harder to misclick)
