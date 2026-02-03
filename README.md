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

## Status
Draft project for Colosseum Agent Hackathon.
