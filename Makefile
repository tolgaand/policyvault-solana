SHELL := /bin/bash

# Repo layout
ONCHAIN_DIR := onchain/policyvault
APP_DIR := app
KEYPAIR := .keypairs/deployer.json
RPC := https://api.devnet.solana.com
LOCALNET_RPC := http://127.0.0.1:8899
LOCALNET_KEYPAIR := .keypairs/localnet.json

.PHONY: help
help:
	@echo "PolicyVault" 
	@echo "  make setup              - install deps (frontend + onchain JS)"
	@echo "  make dev                - run frontend"
	@echo "  make onchain-test       - run anchor tests (devnet)"
	@echo "  make onchain-test-local - run anchor tests on local validator (no faucet)"
	@echo "  make deploy             - build + deploy program (devnet)"
	@echo "  make airdrop            - airdrop 1 SOL to deployer"

.PHONY: setup
setup:
	cd $(APP_DIR) && npm install
	cd $(ONCHAIN_DIR) && yarn install

.PHONY: dev
dev:
	cd $(APP_DIR) && npm run dev

.PHONY: airdrop
airdrop:
	solana airdrop 1 $$(solana-keygen pubkey $(KEYPAIR)) --url $(RPC)

.PHONY: onchain-test
onchain-test:
	./scripts/sync-program-keypair.sh
	cd $(ONCHAIN_DIR) && ANCHOR_WALLET=../../$(KEYPAIR) ANCHOR_PROVIDER_URL=$(RPC) anchor test --skip-local-validator

.PHONY: onchain-test-local
onchain-test-local:
	@if ! command -v cargo-build-sbf >/dev/null 2>&1; then \
		echo "error: cargo-build-sbf not found. Install Solana/Agave CLI v2.x so Anchor can build SBF."; \
		echo "       tip: ensure v2.x is on PATH: export PATH=\"$$HOME/.local/share/solana/install/active_release/bin:$$PATH\""; \
		exit 1; \
	fi
	@if [ ! -f $(KEYPAIR) ]; then \
		echo "error: missing $(KEYPAIR) (devnet deployer keypair)."; \
		echo "       (Never commit keypairs; place it under .keypairs/ locally.)"; \
		exit 1; \
	fi
	./scripts/sync-program-keypair.sh
	cd $(ONCHAIN_DIR) && npm run anchor:test

.PHONY: deploy
deploy:
	./scripts/sync-program-keypair.sh
	cd $(ONCHAIN_DIR) && ANCHOR_WALLET=../../$(KEYPAIR) ANCHOR_PROVIDER_URL=$(RPC) anchor build
	cd $(ONCHAIN_DIR) && ANCHOR_WALLET=../../$(KEYPAIR) ANCHOR_PROVIDER_URL=$(RPC) anchor deploy
