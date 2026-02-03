# PolicyVault

PolicyVault is a policy-enforced spending vault for AI agents on Solana.

## What it is
A simple Solana (Anchor) program + TypeScript client that lets an agent spend funds only within explicit, reviewable rules:

- Daily budget caps
- Allowlists/denylists (merchants / programs / mints)
- Per-recipient caps
- Cooldowns (anti-loop)
- Slippage caps (for swap-style payments)
- On-chain audit log of intents + executions

## Why it matters
Agents increasingly control wallets. The missing primitive is *permissioned spending*: letting an agent operate with guardrails instead of full custody.

## MVP scope (hackathon)
1. **Anchor program (devnet)**
   - `Vault` PDA holds funds
   - `Policy` PDA stores rules
   - `spend_intent` instruction validates policy and records an `AuditEvent`
2. **TS SDK**
   - Create vault/policy
   - Submit spend intent
   - Read audit log
3. **Demo UI**
   - Create policy
   - Attempt allowed vs denied spends

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
