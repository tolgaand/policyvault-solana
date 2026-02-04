# PolicyVault

PolicyVault is not a wallet. It’s a **policy-enforced spending vault** for AI agents.

Give an AI agent a wallet and you’re stuck with two bad choices:
- **No authority** → the agent can’t do useful work
- **Full authority** → a bug, prompt injection, or compromise can drain everything

PolicyVault solves this by letting agents spend **only under explicit rules**. Funds live in a guarded vault, and every spend attempt must pass policy checks before it can execute.

## What it does
- **Controlled spending:** set budget limits, cooldowns, per-recipient caps, and optional allowlists before the agent can spend
- **Auditable trail:** every attempt is recorded — what the agent tried, when, and whether it was allowed or denied
- **Owner control:** update policies anytime, pause instantly with a kill switch, and review all activity

## How it works (conceptually)
1. Create a **Vault** (where funds live)
2. Define a **Policy** (rules like daily cap, cooldown, pause/kill switch, allowlist, per-recipient cap)
3. The agent sends a **Spending Request** (“I want to spend X for Y”)
4. PolicyVault evaluates the request:
   - If it matches policy → **Allowed**
   - If not → **Denied** (with a reason code)
5. Everything is logged for later review

### Denial reason codes
The program records a numeric `reason_code` for each spend attempt (see `programs/policyvault/src/lib.rs`).

| Code | Meaning |
|------|---------|
| 1 | OK |
| 2 | BUDGET_EXCEEDED |
| 3 | COOLDOWN |
| 4 | INVALID_AMOUNT |
| 5 | PAUSED |
| 6 | RECIPIENT_NOT_ALLOWED |
| 7 | RECIPIENT_CAP_EXCEEDED |

## Why now
AI agents are increasingly taking real actions: paying for APIs, subscriptions, infra, and procurement. PolicyVault provides **guardrails + enforcement + auditability**, so agents can operate without uncontrolled financial risk.

## Scope (Hackathon MVP)
A guarded spending vault on Solana with policy enforcement + audit trail.

---

## Dev

### Prereqs
- Node 22+
- Rust toolchain
- Solana/Agave CLI v2.x (CI uses v2.1.7; must include `cargo-build-sbf`)
- Anchor CLI 0.32.1

### Quickstart
```bash
make setup
make dev
```

### Onchain tests
Local validator (recommended for CI-like runs):
```bash
make onchain-test-local
```

Devnet (requires SOL in `.keypairs/deployer.json`):
```bash
make onchain-test
```

## CI
GitHub Actions runs on every PR/push to `main`:
- Frontend: lint + build
- Onchain: `anchor build` + `anchor test` on **localnet** with an ephemeral keypair (no committed secrets)

## Status
Draft project for Colosseum Agent Hackathon.
