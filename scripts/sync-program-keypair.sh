#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ONCHAIN_DIR="$ROOT_DIR/onchain/policyvault"
SRC="$ROOT_DIR/.keypairs/policyvault-program.json"
DST="$ONCHAIN_DIR/target/deploy/policyvault-keypair.json"

mkdir -p "$(dirname "$DST")"

if [[ ! -f "$SRC" ]]; then
  echo "Missing $SRC" >&2
  echo "Create it once by running: (cd $ONCHAIN_DIR && anchor build) then copy target/deploy/policyvault-keypair.json into .keypairs/policyvault-program.json" >&2
  exit 1
fi

cp "$SRC" "$DST"
echo "Synced program keypair -> $DST"
