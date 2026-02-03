const anchor = require("@coral-xyz/anchor");
const { PublicKey, SystemProgram, LAMPORTS_PER_SOL } = anchor.web3;
const assert = require("assert");

describe("policyvault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Policyvault;
  const owner = provider.wallet;

  // PDAs
  let vaultPda, vaultBump;
  let policyPda, policyBump;

  // Budget of 5M lamports; amounts must exceed rent-exempt minimum (~890_880 for 0-byte account)
  // so that recipient accounts pass the post-tx rent-exemption check.
  const DAILY_BUDGET = new anchor.BN(5_000_000);
  const COOLDOWN_SECS = 10; // 10-second cooldown
  const recipient = anchor.web3.Keypair.generate();

  // Track current sequence across tests for PDA derivation.
  let nextSeq = 0;

  before(async () => {
    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), owner.publicKey.toBuffer()],
      program.programId
    );
    [policyPda, policyBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("policy"), vaultPda.toBuffer()],
      program.programId
    );
  });

  // Helper: derive audit PDA for a given sequence number.
  function auditPda(sequence) {
    const seqBuf = Buffer.alloc(8);
    seqBuf.writeBigUInt64LE(BigInt(sequence));
    return PublicKey.findProgramAddressSync(
      [Buffer.from("audit"), policyPda.toBuffer(), seqBuf],
      program.programId
    );
  }

  it("A) initialize_vault", async () => {
    const tx = await program.methods
      .initializeVault()
      .accounts({
        vault: vaultPda,
        owner: owner.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  initialize_vault tx:", tx);

    const vault = await program.account.vault.fetch(vaultPda);
    assert.ok(vault.owner.equals(owner.publicKey));
    assert.strictEqual(vault.bump, vaultBump);
  });

  it("B) initialize_policy (with no agent)", async () => {
    const tx = await program.methods
      .initializePolicy(DAILY_BUDGET, COOLDOWN_SECS, null)
      .accounts({
        policy: policyPda,
        vault: vaultPda,
        owner: owner.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  initialize_policy tx:", tx);

    const policy = await program.account.policy.fetch(policyPda);
    assert.ok(policy.vault.equals(vaultPda));
    assert.ok(policy.authority.equals(owner.publicKey));
    assert.strictEqual(policy.agent, null);
    assert.ok(policy.dailyBudgetLamports.eq(DAILY_BUDGET));
    assert.ok(policy.spentTodayLamports.eq(new anchor.BN(0)));
    assert.strictEqual(policy.cooldownSeconds, COOLDOWN_SECS);
    assert.ok(policy.nextSequence.eq(new anchor.BN(0)));
  });

  it("Fund the vault PDA with SOL for transfers", async () => {
    const tx = await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        SystemProgram.transfer({
          fromPubkey: owner.publicKey,
          toPubkey: vaultPda,
          lamports: LAMPORTS_PER_SOL / 10, // 0.1 SOL
        })
      )
    );
    console.log("  fund vault tx:", tx);
  });

  it("D.1) spend_intent — allowed, SOL transferred to recipient", async () => {
    const seq = nextSeq;
    const [auditPdaKey] = auditPda(seq);
    const amount = new anchor.BN(1_000_000); // 1M lamports (above rent-exempt min)

    const recipientBalBefore = await provider.connection.getBalance(
      recipient.publicKey
    );

    const tx = await program.methods
      .spendIntent(amount)
      .accounts({
        auditEvent: auditPdaKey,
        policy: policyPda,
        vault: vaultPda,
        recipient: recipient.publicKey,
        caller: owner.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  spend_intent (allowed) tx:", tx);
    nextSeq++;

    // Verify audit event
    const audit = await program.account.auditEvent.fetch(auditPdaKey);
    assert.ok(audit.policy.equals(policyPda));
    assert.ok(audit.sequence.eq(new anchor.BN(seq)));
    assert.ok(audit.recipient.equals(recipient.publicKey));
    assert.ok(audit.amount.eq(amount));
    assert.strictEqual(audit.allowed, true);
    assert.strictEqual(audit.reasonCode, 1); // REASON_OK

    // Verify SOL actually transferred
    const recipientBalAfter = await provider.connection.getBalance(
      recipient.publicKey
    );
    assert.strictEqual(
      recipientBalAfter - recipientBalBefore,
      amount.toNumber()
    );

    // Verify policy counters
    const policy = await program.account.policy.fetch(policyPda);
    assert.ok(policy.spentTodayLamports.eq(amount));
    assert.ok(policy.nextSequence.eq(new anchor.BN(nextSeq)));
    assert.ok(policy.lastSpendTs.gt(new anchor.BN(0)));
  });

  it("D.2) spend_intent — denied by cooldown (no transfer)", async () => {
    const seq = nextSeq;
    const [auditPdaKey] = auditPda(seq);
    const amount = new anchor.BN(1_000_000);

    const recipientBalBefore = await provider.connection.getBalance(
      recipient.publicKey
    );

    const tx = await program.methods
      .spendIntent(amount)
      .accounts({
        auditEvent: auditPdaKey,
        policy: policyPda,
        vault: vaultPda,
        recipient: recipient.publicKey,
        caller: owner.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  spend_intent (cooldown denied) tx:", tx);
    nextSeq++;

    const audit = await program.account.auditEvent.fetch(auditPdaKey);
    assert.strictEqual(audit.allowed, false);
    assert.strictEqual(audit.reasonCode, 3); // REASON_COOLDOWN

    // No SOL should have moved
    const recipientBalAfter = await provider.connection.getBalance(
      recipient.publicKey
    );
    assert.strictEqual(recipientBalAfter, recipientBalBefore);

    // spent_today unchanged
    const policy = await program.account.policy.fetch(policyPda);
    assert.ok(policy.spentTodayLamports.eq(new anchor.BN(1_000_000)));
    assert.ok(policy.nextSequence.eq(new anchor.BN(nextSeq)));
  });

  it("D.3) spend_intent — denied by budget exceeded (no transfer)", async () => {
    const seq = nextSeq;
    const [auditPdaKey] = auditPda(seq);
    // Request more than remaining budget (5M - 1M spent = 4M remaining)
    const amount = new anchor.BN(4_500_000);

    const recipientBalBefore = await provider.connection.getBalance(
      recipient.publicKey
    );

    const tx = await program.methods
      .spendIntent(amount)
      .accounts({
        auditEvent: auditPdaKey,
        policy: policyPda,
        vault: vaultPda,
        recipient: recipient.publicKey,
        caller: owner.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  spend_intent (budget denied) tx:", tx);
    nextSeq++;

    const audit = await program.account.auditEvent.fetch(auditPdaKey);
    assert.strictEqual(audit.allowed, false);
    assert.strictEqual(audit.reasonCode, 2); // REASON_BUDGET_EXCEEDED

    // No SOL should have moved
    const recipientBalAfter = await provider.connection.getBalance(
      recipient.publicKey
    );
    assert.strictEqual(recipientBalAfter, recipientBalBefore);

    const policy = await program.account.policy.fetch(policyPda);
    assert.ok(policy.spentTodayLamports.eq(new anchor.BN(1_000_000)));
    assert.ok(policy.nextSequence.eq(new anchor.BN(nextSeq)));
  });

  it("D.4) spend_intent — unauthorized caller rejected", async () => {
    const seq = nextSeq;
    const [auditPdaKey] = auditPda(seq);
    const amount = new anchor.BN(1_000_000);
    const rando = anchor.web3.Keypair.generate();

    // Airdrop SOL so rando can pay for tx fees
    const sig = await provider.connection.requestAirdrop(
      rando.publicKey,
      LAMPORTS_PER_SOL / 10
    );
    await provider.connection.confirmTransaction(sig);

    try {
      await program.methods
        .spendIntent(amount)
        .accounts({
          auditEvent: auditPdaKey,
          policy: policyPda,
          vault: vaultPda,
          recipient: recipient.publicKey,
          caller: rando.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([rando])
        .rpc();
      assert.fail("Should have thrown Unauthorized");
    } catch (err) {
      assert.ok(
        err.toString().includes("Unauthorized"),
        `Expected Unauthorized error, got: ${err}`
      );
    }
    // Sequence does NOT advance on failure (tx rolled back)
  });

  it("C) set_policy — authority updates budget, cooldown, and agent", async () => {
    const agentKp = anchor.web3.Keypair.generate();
    const newBudget = new anchor.BN(50_000_000); // 50M lamports
    const newCooldown = 0; // disable cooldown

    const tx = await program.methods
      .setPolicy(newBudget, newCooldown, agentKp.publicKey)
      .accounts({
        policy: policyPda,
        vault: vaultPda,
        authority: owner.publicKey,
      })
      .rpc();
    console.log("  set_policy tx:", tx);

    const policy = await program.account.policy.fetch(policyPda);
    assert.ok(policy.dailyBudgetLamports.eq(newBudget));
    assert.strictEqual(policy.cooldownSeconds, newCooldown);
    assert.ok(policy.agent.equals(agentKp.publicKey));
  });

  it("D.5) spend_intent — allowed after cooldown disabled via set_policy", async () => {
    const seq = nextSeq;
    const [auditPdaKey] = auditPda(seq);
    const amount = new anchor.BN(2_000_000);

    const recipientBalBefore = await provider.connection.getBalance(
      recipient.publicKey
    );

    const tx = await program.methods
      .spendIntent(amount)
      .accounts({
        auditEvent: auditPdaKey,
        policy: policyPda,
        vault: vaultPda,
        recipient: recipient.publicKey,
        caller: owner.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  spend_intent (allowed after policy update) tx:", tx);
    nextSeq++;

    const audit = await program.account.auditEvent.fetch(auditPdaKey);
    assert.strictEqual(audit.allowed, true);
    assert.strictEqual(audit.reasonCode, 1);

    // Verify SOL transferred
    const recipientBalAfter = await provider.connection.getBalance(
      recipient.publicKey
    );
    assert.strictEqual(
      recipientBalAfter - recipientBalBefore,
      amount.toNumber()
    );

    const policy = await program.account.policy.fetch(policyPda);
    // 1M + 2M = 3M (cooldown and budget denied didn't add)
    assert.ok(policy.spentTodayLamports.eq(new anchor.BN(3_000_000)));
    assert.ok(policy.nextSequence.eq(new anchor.BN(nextSeq)));
  });

  it("E) close_audit_event — authority reclaims rent", async () => {
    // Close the first audit event (sequence 0)
    const [auditPdaKey] = auditPda(0);

    // Confirm audit account exists before closing
    const auditBefore = await program.account.auditEvent.fetch(auditPdaKey);
    assert.ok(auditBefore.policy.equals(policyPda));

    const authorityBalBefore = await provider.connection.getBalance(
      owner.publicKey
    );

    const tx = await program.methods
      .closeAuditEvent()
      .accounts({
        auditEvent: auditPdaKey,
        policy: policyPda,
        authority: owner.publicKey,
      })
      .rpc();
    console.log("  close_audit_event tx:", tx);

    // Account should no longer exist
    const auditInfo = await provider.connection.getAccountInfo(auditPdaKey);
    assert.strictEqual(auditInfo, null);

    // Authority should have received rent back (minus tx fee)
    const authorityBalAfter = await provider.connection.getBalance(
      owner.publicKey
    );
    assert.ok(authorityBalAfter > authorityBalBefore - 10_000);
  });

  it("E.2) close_audit_event — non-authority rejected", async () => {
    // Use sequence 1 audit event (cooldown denied one)
    const [auditPdaKey] = auditPda(1);
    const rando = anchor.web3.Keypair.generate();

    const sig = await provider.connection.requestAirdrop(
      rando.publicKey,
      LAMPORTS_PER_SOL / 10
    );
    await provider.connection.confirmTransaction(sig);

    try {
      await program.methods
        .closeAuditEvent()
        .accounts({
          auditEvent: auditPdaKey,
          policy: policyPda,
          authority: rando.publicKey,
        })
        .signers([rando])
        .rpc();
      assert.fail("Should have thrown Unauthorized");
    } catch (err) {
      assert.ok(
        err.toString().includes("Unauthorized"),
        `Expected Unauthorized error, got: ${err}`
      );
    }
  });
});
