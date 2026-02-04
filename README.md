# PolicyVault

**Policy-enforced spending vaults for AI agents on Solana.**

AI agents need to spend money — paying for APIs, infra, subscriptions. But giving an agent a wallet means choosing between *no authority* (useless) and *full authority* (dangerous). PolicyVault eliminates this tradeoff: funds live in a guarded vault, and every spend must pass explicit policy checks enforced on-chain before a single lamport moves.

---

## The Problem

AI agents are becoming economic actors. They need to pay for things autonomously. Today's options are bad:

| Approach | Risk |
|----------|------|
| Give the agent the private key | A bug, prompt injection, or compromise drains everything |
| Require human approval for every tx | Agent can't operate autonomously |
| Off-chain spending rules | Rules aren't enforceable — the agent can ignore them |

There is no on-chain primitive that lets an owner say *"this agent can spend up to X SOL per day, with a cooldown, only to approved recipients"* and have it enforced at the protocol level.

## The Solution

PolicyVault is a Solana program that creates **owner-controlled spending vaults** with programmable policy enforcement.

1. **Owner creates a Vault** — SOL lives here, not in the agent's wallet
2. **Owner defines a Policy** — daily budget, cooldown, pause switch, recipient allowlist, per-recipient caps
3. **Agent sends a Spend Intent** — "I want to send X lamports to Y"
4. **Program evaluates on-chain** — if policy allows, SOL transfers; if not, the attempt is denied with a reason code
5. **Everything is logged** — every attempt (allowed or denied) creates an immutable AuditEvent PDA

The owner can update policies, pause spending instantly, and review the full audit trail — all without touching the agent's code.

---

## What's Live

| Component | Status | Description |
|-----------|--------|-------------|
| **Solana Program** | Localnet + Devnet | Anchor program with 11 passing tests |
| **React App** | Dev builds | Wallet-connected UI for vault management and spend simulation |
| **Preflight Validation** | Shipped | Client-side pipeline mirroring on-chain logic (32 tests) |
| **CI** | GitHub Actions | Frontend lint+build, on-chain build+test on localnet |

**Program ID:** `DiWRnGf1JpqZrL8n9dUA9bUaJ4ruBVvmmKBcrdp7tJLD`

> Not yet deployed to mainnet. Current testing is on localnet and devnet.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Owner (human)                        │
│  Sets policy, funds vault, reviews audit trail           │
└────────────┬─────────────────────────────────────────────┘
             │
             ▼
┌──────────────────────────────────────────────────────────┐
│              Solana Program (Anchor)                     │
│                                                          │
│  ┌─────────┐   ┌──────────┐   ┌──────────────────────┐  │
│  │  Vault   │   │  Policy   │   │   RecipientSpend    │  │
│  │  (PDA)   │   │  (PDA)    │   │   (PDA per pair)    │  │
│  │          │   │           │   │                      │  │
│  │ Holds SOL│   │ Budget    │   │ Per-recipient daily  │  │
│  │          │   │ Cooldown  │   │ spend tracking       │  │
│  │          │   │ Allowlist │   │                      │  │
│  │          │   │ Pause     │   │                      │  │
│  │          │   │ Caps      │   │                      │  │
│  └─────────┘   └──────────┘   └──────────────────────┘  │
│                                                          │
│  spend_intent / spend_intent_v2                          │
│    → Evaluate policy → Transfer or deny → AuditEvent PDA │
└──────────────────────────────────────────────────────────┘
             ▲
             │
┌────────────┴─────────────────────────────────────────────┐
│                   Agent (AI)                              │
│  Calls spend_intent_v2 with amount + recipient           │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Preflight pipeline (app/src/preflight.ts)         │  │
│  │  Client-side mirror of on-chain checks.            │  │
│  │  Catches errors before submitting the transaction. │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### On-chain instructions

| Instruction | Purpose |
|-------------|---------|
| `initialize_vault` | Create a Vault PDA for the owner |
| `initialize_policy` | Create a Policy PDA linked to a vault |
| `set_policy` | Update budget, cooldown, agent key |
| `set_policy_advanced` | Update all policy fields (pause, allowlist, caps) |
| `spend_intent` | Basic spend with budget + cooldown enforcement |
| `spend_intent_v2` | Full spend with pause, allowlist, per-recipient caps |
| `close_audit_event` | Reclaim rent from old audit PDAs |
| `close_recipient_spend` | Reclaim rent from recipient trackers |

### Denial reason codes

| Code | Meaning |
|------|---------|
| 1 | OK |
| 2 | BUDGET_EXCEEDED |
| 3 | COOLDOWN |
| 4 | INVALID_AMOUNT |
| 5 | PAUSED |
| 6 | RECIPIENT_NOT_ALLOWED |
| 7 | RECIPIENT_CAP_EXCEEDED |

### Preflight validation

`app/src/preflight.ts` is a pure-function pipeline that mirrors all on-chain policy checks client-side. It runs before transaction submission and returns field-level errors with actionable messages. This prevents wasted transactions and gives the agent (or UI) immediate feedback.

- 32 unit tests via Vitest
- Zero React/Anchor dependencies — usable in any JS/TS context

---

## Quick Start

### Prerequisites

- Node 22+
- Rust toolchain
- Solana/Agave CLI v2.x (must include `cargo-build-sbf`)
- Anchor CLI 0.32.1

### Install and run

```bash
git clone https://github.com/<your-org>/policyvault.git
cd policyvault

# Install all dependencies
make setup

# Run the frontend (Vite dev server)
make dev
```

### Run tests

```bash
# Frontend preflight tests (32 tests)
cd app && npm test

# On-chain tests on local validator (11 tests)
make onchain-test-local
```

### Deploy to devnet

```bash
# Airdrop SOL to your deployer keypair
make airdrop

# Build and deploy
make deploy
```

---

## How to Verify (Demo Steps)

1. **Start the app:** `make dev` — opens at `http://localhost:5173`
2. **Connect wallet:** Click "Connect Wallet" (Phantom or any Solana wallet on devnet)
3. **Create a vault:** Click "Initialize Vault" — creates a Vault PDA owned by your wallet
4. **Set a policy:** Configure daily budget (e.g. 1 SOL), cooldown (e.g. 10s), and initialize
5. **Fund the vault:** Transfer SOL to the vault PDA address shown in the UI
6. **Simulate a spend:** Enter an amount and recipient, click "Spend Intent"
   - If within policy: SOL transfers, AuditEvent is created
   - If denied: no transfer, but the denial reason is shown (e.g. BUDGET_EXCEEDED)
7. **Test preflight:** Enter an amount that exceeds the daily budget — the preflight pipeline catches it before the transaction is even submitted

---

## Roadmap (Sprint 001)

| ID | Task | Status |
|----|------|--------|
| S1-1 | Preflight spend_intent_v2 validation pipeline | Done |
| S1-2 | UI feedback for preflight errors (inline guidance) | Planned |
| S1-3 | Audit trail timeline view | Planned |
| S1-4 | Audit trail filters + export | Planned |
| S1-5 | Demo polish sweep (copy, empty/error states, nav) | Planned |
| S1-6 | Demo links package (URL, screencast, deck outline) | Planned |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| On-chain program | Rust, Anchor 0.32 |
| Frontend | React 19, TypeScript, Vite 7 |
| Wallet integration | Solana Wallet Adapter |
| Testing (on-chain) | Mocha + Chai, local validator |
| Testing (frontend) | Vitest |
| CI | GitHub Actions |

---

## Security and Privacy Notes

**What PolicyVault enforces:**
- All policy checks happen on-chain in the Solana program. The agent cannot bypass them.
- Audit events are immutable PDAs — the agent cannot delete or alter its spend history.
- The owner can pause spending instantly via the `paused` flag.

**What PolicyVault does NOT do:**
- **No front-running protection.** Spend intents are standard Solana transactions visible in the mempool. A sophisticated attacker could observe and front-run them. For the current use case (controlled agent spending), this is acceptable — the vault owner controls both sides.
- **No encrypted audit data.** AuditEvent PDAs are public on-chain. Anyone can read the spend amounts, recipients, and timestamps. This is a design choice: auditability over privacy.
- **No mainnet deployment yet.** The program has not been audited. Use on devnet/localnet only.

**Tradeoff: Auditability vs. Privacy**

PolicyVault prioritizes full transparency of agent behavior over transaction privacy. Every spend attempt — allowed or denied — is permanently recorded on-chain with amount, recipient, timestamp, and reason code. This makes the system easy to audit but means all spending activity is public. Future versions may explore encrypted audit logs or ZK proofs for privacy-sensitive use cases.

---

## Project Structure

```
policyvault/
├── onchain/policyvault/          # Anchor workspace
│   ├── programs/policyvault/     # Solana program (Rust)
│   │   └── src/lib.rs            # All instructions, accounts, events
│   └── tests/                    # On-chain integration tests (JS)
├── app/                          # React frontend
│   └── src/
│       ├── DemoApp.tsx           # Main demo UI component
│       ├── preflight.ts          # Preflight validation pipeline
│       ├── preflight.test.ts     # 32 unit tests
│       └── policyvault.ts        # Anchor client utilities
├── scripts/                      # Build/deploy helpers
├── pm/sprints/                   # Sprint planning
└── Makefile                      # Dev commands
```

---

## License

MIT
