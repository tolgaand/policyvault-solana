SHELL := /bin/bash

# Repo layout
ONCHAIN_DIR := onchain/policyvault
APP_DIR := app
KEYPAIR := .keypairs/deployer.json
RPC := https://api.devnet.solana.com

.PHONY: help
help:
	@echo "PolicyVault" 
	@echo "  make setup          - install deps (frontend + onchain JS)"
	@echo "  make dev            - run frontend"
	@echo "  make onchain-test   - run anchor tests (devnet)"
	@echo "  make deploy         - build + deploy program (devnet)"
	@echo "  make airdrop        - airdrop 1 SOL to deployer"

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

.PHONY: deploy
deploy:
	./scripts/sync-program-keypair.sh
	cd $(ONCHAIN_DIR) && ANCHOR_WALLET=../../$(KEYPAIR) ANCHOR_PROVIDER_URL=$(RPC) anchor build
	cd $(ONCHAIN_DIR) && ANCHOR_WALLET=../../$(KEYPAIR) ANCHOR_PROVIDER_URL=$(RPC) anchor deploy
