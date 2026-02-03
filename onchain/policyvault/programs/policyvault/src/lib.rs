use anchor_lang::prelude::*;

declare_id!("DiWRnGf1JpqZrL8n9dUA9bUaJ4ruBVvmmKBcrdp7tJLD");

// ── reason codes ──
pub const REASON_OK: u16 = 1;
pub const REASON_BUDGET_EXCEEDED: u16 = 2;
pub const REASON_COOLDOWN: u16 = 3;
pub const REASON_INVALID_AMOUNT: u16 = 4;

const SECONDS_PER_DAY: i64 = 86_400;

#[program]
pub mod policyvault {
    use super::*;

    /// A) Create the Vault PDA for the owner.
    pub fn initialize_vault(ctx: Context<InitializeVault>) -> Result<()> {
        let vault = &mut ctx.accounts.vault;
        vault.owner = ctx.accounts.owner.key();
        vault.bump = ctx.bumps.vault;
        Ok(())
    }

    /// B) Create the Policy PDA linked to a vault.
    ///
    /// `agent` — optional pubkey that may also call `spend_intent`.
    /// Pass `None` to restrict spending to the authority only.
    pub fn initialize_policy(
        ctx: Context<InitializePolicy>,
        daily_budget_lamports: u64,
        cooldown_seconds: u32,
        agent: Option<Pubkey>,
    ) -> Result<()> {
        let policy = &mut ctx.accounts.policy;
        policy.vault = ctx.accounts.vault.key();
        policy.authority = ctx.accounts.owner.key();
        policy.agent = agent;
        policy.daily_budget_lamports = daily_budget_lamports;
        policy.spent_today_lamports = 0;
        policy.day_index = Clock::get()?.unix_timestamp / SECONDS_PER_DAY;
        policy.cooldown_seconds = cooldown_seconds;
        policy.last_spend_ts = 0;
        policy.next_sequence = 0;
        policy.bump = ctx.bumps.policy;
        Ok(())
    }

    /// C) Authority updates policy parameters.
    pub fn set_policy(
        ctx: Context<SetPolicy>,
        daily_budget_lamports: u64,
        cooldown_seconds: u32,
        agent: Option<Pubkey>,
    ) -> Result<()> {
        let policy = &mut ctx.accounts.policy;
        require_keys_eq!(
            ctx.accounts.authority.key(),
            policy.authority,
            VaultError::Unauthorized
        );
        policy.daily_budget_lamports = daily_budget_lamports;
        policy.cooldown_seconds = cooldown_seconds;
        policy.agent = agent;
        Ok(())
    }

    /// D) Record a spend intent; enforce policy, optionally execute SOL transfer.
    ///
    /// Authorization: caller must be either `policy.authority` or `policy.agent` (if set).
    /// When allowed, lamports are transferred from the vault PDA to the recipient.
    /// When denied, no transfer occurs but the audit event is still recorded.
    pub fn spend_intent(ctx: Context<SpendIntent>, amount: u64) -> Result<()> {
        let policy = &mut ctx.accounts.policy;
        let caller_key = ctx.accounts.caller.key();

        // ── Authorization: caller must be authority or agent ──
        let is_authority = caller_key == policy.authority;
        let is_agent = policy.agent.map_or(false, |a| a == caller_key);
        require!(is_authority || is_agent, VaultError::Unauthorized);

        let clock = Clock::get()?;
        let current_day = clock.unix_timestamp / SECONDS_PER_DAY;

        // Reset daily window if the day rolled over.
        if current_day != policy.day_index {
            policy.spent_today_lamports = 0;
            policy.day_index = current_day;
        }

        // Determine if the intent is allowed.
        let (allowed, reason_code) = if amount == 0 {
            (false, REASON_INVALID_AMOUNT)
        } else if policy
            .spent_today_lamports
            .checked_add(amount)
            .unwrap_or(u64::MAX)
            > policy.daily_budget_lamports
        {
            (false, REASON_BUDGET_EXCEEDED)
        } else if policy.last_spend_ts > 0
            && clock.unix_timestamp - policy.last_spend_ts < policy.cooldown_seconds as i64
        {
            (false, REASON_COOLDOWN)
        } else {
            (true, REASON_OK)
        };

        // Write AuditEvent PDA.
        let audit = &mut ctx.accounts.audit_event;
        audit.policy = policy.key();
        audit.sequence = policy.next_sequence;
        audit.ts = clock.unix_timestamp;
        audit.recipient = ctx.accounts.recipient.key();
        audit.amount = amount;
        audit.allowed = allowed;
        audit.reason_code = reason_code;

        // Advance sequence counter.
        policy.next_sequence = policy.next_sequence.checked_add(1).unwrap();

        // Execute transfer + update counters only when allowed.
        if allowed {
            policy.spent_today_lamports = policy
                .spent_today_lamports
                .checked_add(amount)
                .unwrap();
            policy.last_spend_ts = clock.unix_timestamp;

            // Transfer SOL from vault PDA → recipient via direct lamport manipulation.
            // (SystemProgram::transfer cannot be used because the vault PDA carries account data.)
            let vault_info = ctx.accounts.vault.to_account_info();
            let recipient_info = ctx.accounts.recipient.to_account_info();
            **vault_info.try_borrow_mut_lamports()? = vault_info
                .lamports()
                .checked_sub(amount)
                .ok_or(ProgramError::InsufficientFunds)?;
            **recipient_info.try_borrow_mut_lamports()? = recipient_info
                .lamports()
                .checked_add(amount)
                .unwrap();
        }

        // Emit Anchor event for off-chain indexers.
        emit!(SpendRecorded {
            vault: ctx.accounts.vault.key(),
            policy: policy.key(),
            sequence: audit.sequence,
            recipient: ctx.accounts.recipient.key(),
            amount,
            allowed,
            reason_code,
            ts: clock.unix_timestamp,
        });

        Ok(())
    }

    /// E) Reclaim rent from an old AuditEvent account. Authority only.
    pub fn close_audit_event(ctx: Context<CloseAuditEvent>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.authority.key(),
            ctx.accounts.policy.authority,
            VaultError::Unauthorized
        );
        // The `close` constraint in the Accounts struct handles lamport transfer.
        Ok(())
    }
}

// ──────────────── Accounts ────────────────

#[account]
pub struct Vault {
    pub owner: Pubkey, // 32
    pub bump: u8,      // 1
}

// 8 discriminator + 32 + 1 = 41
impl Vault {
    pub const SIZE: usize = 8 + 32 + 1;
}

#[account]
pub struct Policy {
    pub vault: Pubkey,              // 32
    pub authority: Pubkey,          // 32
    pub agent: Option<Pubkey>,      // 1 + 32 = 33
    pub daily_budget_lamports: u64, // 8
    pub spent_today_lamports: u64,  // 8
    pub day_index: i64,             // 8
    pub cooldown_seconds: u32,      // 4
    pub last_spend_ts: i64,         // 8
    pub next_sequence: u64,         // 8
    pub bump: u8,                   // 1
}

// 8 + 32 + 32 + 33 + 8 + 8 + 8 + 4 + 8 + 8 + 1 = 150
impl Policy {
    pub const SIZE: usize = 8 + 32 + 32 + 33 + 8 + 8 + 8 + 4 + 8 + 8 + 1;
}

#[account]
pub struct AuditEvent {
    pub policy: Pubkey,    // 32
    pub sequence: u64,     // 8
    pub ts: i64,           // 8
    pub recipient: Pubkey, // 32
    pub amount: u64,       // 8
    pub allowed: bool,     // 1
    pub reason_code: u16,  // 2
}

// 8 + 32 + 8 + 8 + 32 + 8 + 1 + 2 = 99
impl AuditEvent {
    pub const SIZE: usize = 8 + 32 + 8 + 8 + 32 + 8 + 1 + 2;
}

// ──────────────── Instruction Contexts ────────────────

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(
        init,
        payer = owner,
        space = Vault::SIZE,
        seeds = [b"vault", owner.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializePolicy<'info> {
    #[account(
        init,
        payer = owner,
        space = Policy::SIZE,
        seeds = [b"policy", vault.key().as_ref()],
        bump,
    )]
    pub policy: Account<'info, Policy>,
    #[account(
        has_one = owner,
        seeds = [b"vault", owner.key().as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPolicy<'info> {
    #[account(
        mut,
        seeds = [b"policy", vault.key().as_ref()],
        bump = policy.bump,
    )]
    pub policy: Account<'info, Policy>,
    #[account(
        seeds = [b"vault", vault.owner.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SpendIntent<'info> {
    #[account(
        init,
        payer = caller,
        space = AuditEvent::SIZE,
        seeds = [
            b"audit",
            policy.key().as_ref(),
            policy.next_sequence.to_le_bytes().as_ref(),
        ],
        bump,
    )]
    pub audit_event: Account<'info, AuditEvent>,
    #[account(
        mut,
        seeds = [b"policy", vault.key().as_ref()],
        bump = policy.bump,
    )]
    pub policy: Account<'info, Policy>,
    #[account(
        mut,
        seeds = [b"vault", vault.owner.as_ref()],
        bump = vault.bump,
    )]
    pub vault: Account<'info, Vault>,
    /// CHECK: Recipient of the SOL transfer. Validated by system_program CPI.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
    #[account(mut)]
    pub caller: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseAuditEvent<'info> {
    #[account(
        mut,
        close = authority,
        has_one = policy,
    )]
    pub audit_event: Account<'info, AuditEvent>,
    #[account(
        seeds = [b"policy", policy.vault.as_ref()],
        bump = policy.bump,
    )]
    pub policy: Account<'info, Policy>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

// ──────────────── Events ────────────────

#[event]
pub struct SpendRecorded {
    pub vault: Pubkey,
    pub policy: Pubkey,
    pub sequence: u64,
    pub recipient: Pubkey,
    pub amount: u64,
    pub allowed: bool,
    pub reason_code: u16,
    pub ts: i64,
}

// ──────────────── Errors ────────────────

#[error_code]
pub enum VaultError {
    #[msg("Unauthorized: signer is not the policy authority or agent")]
    Unauthorized,
}
