const anchor = require("@coral-xyz/anchor");
const { PublicKey, SystemProgram } = anchor.web3;
const assert = require("assert");

describe("policyvault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Policyvault;
  const owner = provider.wallet;

  // PDAs
  let vaultPda, vaultBump;
  let policyPda, policyBump;

  const DAILY_BUDGET = new anchor.BN(1_000_000); // 1M lamports
  const COOLDOWN_SECS = 10; // 10-second cooldown
  const recipient = anchor.web3.Keypair.generate().publicKey;

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

  it("B) initialize_policy", async () => {
    const tx = await program.methods
      .initializePolicy(DAILY_BUDGET, COOLDOWN_SECS)
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
    assert.ok(policy.dailyBudgetLamports.eq(DAILY_BUDGET));
    assert.ok(policy.spentTodayLamports.eq(new anchor.BN(0)));
    assert.strictEqual(policy.cooldownSeconds, COOLDOWN_SECS);
    assert.ok(policy.nextSequence.eq(new anchor.BN(0)));
  });

  it("D.1) spend_intent — first call allowed", async () => {
    const [auditPdaKey] = auditPda(0);
    const amount = new anchor.BN(100_000);

    const tx = await program.methods
      .spendIntent(recipient, amount)
      .accounts({
        auditEvent: auditPdaKey,
        policy: policyPda,
        vault: vaultPda,
        caller: owner.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  spend_intent (allowed) tx:", tx);

    // Check audit event
    const audit = await program.account.auditEvent.fetch(auditPdaKey);
    assert.ok(audit.policy.equals(policyPda));
    assert.ok(audit.sequence.eq(new anchor.BN(0)));
    assert.ok(audit.recipient.equals(recipient));
    assert.ok(audit.amount.eq(amount));
    assert.strictEqual(audit.allowed, true);
    assert.strictEqual(audit.reasonCode, 1); // REASON_OK

    // Check policy counters
    const policy = await program.account.policy.fetch(policyPda);
    assert.ok(policy.spentTodayLamports.eq(amount));
    assert.ok(policy.nextSequence.eq(new anchor.BN(1)));
    assert.ok(policy.lastSpendTs.gt(new anchor.BN(0)));
  });

  it("D.2) spend_intent — second call denied by cooldown", async () => {
    const [auditPdaKey] = auditPda(1);
    const amount = new anchor.BN(50_000);

    const tx = await program.methods
      .spendIntent(recipient, amount)
      .accounts({
        auditEvent: auditPdaKey,
        policy: policyPda,
        vault: vaultPda,
        caller: owner.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  spend_intent (cooldown denied) tx:", tx);

    const audit = await program.account.auditEvent.fetch(auditPdaKey);
    assert.strictEqual(audit.allowed, false);
    assert.strictEqual(audit.reasonCode, 3); // REASON_COOLDOWN

    // Policy spent_today should NOT have increased
    const policy = await program.account.policy.fetch(policyPda);
    assert.ok(policy.spentTodayLamports.eq(new anchor.BN(100_000)));
    assert.ok(policy.nextSequence.eq(new anchor.BN(2)));
  });

  it("D.3) spend_intent — denied by budget exceeded", async () => {
    const [auditPdaKey] = auditPda(2);
    // Request more than the remaining budget (1M - 100K spent = 900K remaining)
    const amount = new anchor.BN(950_000);

    const tx = await program.methods
      .spendIntent(recipient, amount)
      .accounts({
        auditEvent: auditPdaKey,
        policy: policyPda,
        vault: vaultPda,
        caller: owner.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  spend_intent (budget denied) tx:", tx);

    const audit = await program.account.auditEvent.fetch(auditPdaKey);
    assert.strictEqual(audit.allowed, false);
    assert.strictEqual(audit.reasonCode, 2); // REASON_BUDGET_EXCEEDED

    const policy = await program.account.policy.fetch(policyPda);
    // Still 100K spent, unchanged
    assert.ok(policy.spentTodayLamports.eq(new anchor.BN(100_000)));
    assert.ok(policy.nextSequence.eq(new anchor.BN(3)));
  });

  it("C) set_policy — authority updates budget and cooldown", async () => {
    const newBudget = new anchor.BN(5_000_000);
    const newCooldown = 0; // disable cooldown

    const tx = await program.methods
      .setPolicy(newBudget, newCooldown)
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
  });

  it("D.4) spend_intent — allowed after cooldown disabled via set_policy", async () => {
    const [auditPdaKey] = auditPda(3);
    const amount = new anchor.BN(200_000);

    const tx = await program.methods
      .spendIntent(recipient, amount)
      .accounts({
        auditEvent: auditPdaKey,
        policy: policyPda,
        vault: vaultPda,
        caller: owner.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log("  spend_intent (allowed after policy update) tx:", tx);

    const audit = await program.account.auditEvent.fetch(auditPdaKey);
    assert.strictEqual(audit.allowed, true);
    assert.strictEqual(audit.reasonCode, 1);

    const policy = await program.account.policy.fetch(policyPda);
    // 100K + 200K = 300K
    assert.ok(policy.spentTodayLamports.eq(new anchor.BN(300_000)));
    assert.ok(policy.nextSequence.eq(new anchor.BN(4)));
  });
});
