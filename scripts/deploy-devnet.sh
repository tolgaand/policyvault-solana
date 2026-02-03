#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RPC_URL="https://api.devnet.solana.com"
KEYPAIR="$ROOT_DIR/.keypairs/deployer.json"
ONCHAIN="$ROOT_DIR/onchain/policyvault"

if [[ ! -f "$KEYPAIR" ]]; then
  echo "Missing keypair: $KEYPAIR" >&2
  exit 1
fi

export ANCHOR_WALLET="$KEYPAIR"
export ANCHOR_PROVIDER_URL="$RPC_URL"

cd "$ONCHAIN"
echo "==> anchor build"
anchor build

echo "==> anchor deploy"
anchor deploy

echo "Done. Program deployed to devnet."
