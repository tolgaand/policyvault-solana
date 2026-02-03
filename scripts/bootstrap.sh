#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

echo "[+] Setting Solana to devnet"
solana config set --url https://api.devnet.solana.com >/dev/null

echo "[+] Ensuring keypair exists (.keypairs/devnet.json)"
mkdir -p .keypairs
if [[ ! -f .keypairs/devnet.json ]]; then
  solana-keygen new --no-bip39-passphrase -o .keypairs/devnet.json
fi
PUBKEY=$(solana-keygen pubkey .keypairs/devnet.json)
echo "    pubkey: $PUBKEY"

echo "[+] Airdrop 2 SOL (devnet)"
solana airdrop 2 "$PUBKEY" || true

if [[ -f package.json ]]; then
  echo "[+] npm install (root)"
  npm install
fi

if [[ -f app/package.json ]]; then
  echo "[+] npm install (app)"
  (cd app && npm install)
fi

echo "[+] Done"
