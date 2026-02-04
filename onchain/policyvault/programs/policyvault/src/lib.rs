use anchor_lang::prelude::*;

declare_id!("DiWRnGf1JpqZrL8n9dUA9bUaJ4ruBVvmmKBcrdp7tJLD");

// ── reason codes ──
pub const REASON_OK: u16 = 1;
pub const REASON_BUDGET_EXCEEDED: u16 = 2;
pub const REASON_COOLDOWN: u16 = 3;
pub const REASON_INVALID_AMOUNT: u16 = 4;
pub const REASON_PAUSED: u16 = 5;
pub const REASON_RECIPIENT_NOT_ALLOWED: u16 = 6;
pub const REASON_RECIPIENT_CAP_EXCEEDED: u16 = 7;

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
        // advanced defaults
        policy.paused = false;
        policy.allowlist_enabled = false;
        policy.allowed_recipient = None;
        policy.per_recipient_daily_cap_lamports = 0;
        policy.policy_version = 1;
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
        policy.policy_version = policy.policy_version.saturating_add(1);
        Ok(())
    }

    /// C.2) Authority updates advanced policy parameters.
    ///
    /// This is an additive API (keeps `set_policy` as the simple MVP surface).
    pub fn set_policy_advanced(
        ctx: Context<SetPolicy>,
        daily_budget_lamports: u64,
        cooldown_seconds: u32,
        agent: Option<Pubkey>,
        paused: bool,
        allowlist_enabled: bool,
        allowed_recipient: Option<Pubkey>,
        per_recipient_daily_cap_lamports: u64,
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

        policy.paused = paused;
        policy.allowlist_enabled = allowlist_enabled;
        policy.allowed_recipient = allowed_recipient;
        policy.per_recipient_daily_cap_lamports = per_recipient_daily_cap_lamports;

        policy.policy_version = policy.policy_version.saturating_add(1);
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
        audit.policy_version = policy.policy_version;

        // Advance sequence counter.
        policy.next_sequence = policy.next_sequence.checked_add(1).unwrap();

        // Execute transfer + update counters only when allowed.
        if allowed {
            policy.spent_today_lamports = policy.spent_today_lamports.checked_add(amount).unwrap();
            policy.last_spend_ts = clock.unix_timestamp;

            // Transfer SOL from vault PDA → recipient via direct lamport manipulation.
            // (SystemProgram::transfer cannot be used because the vault PDA carries account data.)
            let vault_info = ctx.accounts.vault.to_account_info();
            let recipient_info = ctx.accounts.recipient.to_account_info();
            **vault_info.try_borrow_mut_lamports()? = vault_info
                .lamports()
                .checked_sub(amount)
                .ok_or(ProgramError::InsufficientFunds)?;
            **recipient_info.try_borrow_mut_lamports()? =
                recipient_info.lamports().checked_add(amount).unwrap();
        }

        // Emit Anchor event for off-chain indexers.
        emit!(SpendRecorded {
            vault: ctx.accounts.vault.key(),
            policy: policy.key(),
            policy_version: policy.policy_version,
            sequence: audit.sequence,
            recipient: ctx.accounts.recipient.key(),
            amount,
            allowed,
            reason_code,
            ts: clock.unix_timestamp,
        });

        Ok(())
    }

    /// D.2) Spend intent with per-recipient tracking.
    ///
    /// Adds enforceable switches:
    /// - `paused` (kill switch)
    /// - `allowlist_enabled` + `allowed_recipient` (simple allowlist)
    /// - `per_recipient_daily_cap_lamports` enforced via `RecipientSpend` PDA
    pub fn spend_intent_v2(ctx: Context<SpendIntentV2>, amount: u64) -> Result<()> {
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

        // Keep per-recipient tracker on same day window.
        let recipient_spend = &mut ctx.accounts.recipient_spend;
        if recipient_spend.policy == Pubkey::default() {
            // init_if_needed created the account; fill fixed fields.
            recipient_spend.policy = policy.key();
            recipient_spend.recipient = ctx.accounts.recipient.key();
            recipient_spend.spent_today_lamports = 0;
            recipient_spend.day_index = current_day;
            recipient_spend.bump = ctx.bumps.recipient_spend;
        } else if recipient_spend.day_index != current_day {
            recipient_spend.spent_today_lamports = 0;
            recipient_spend.day_index = current_day;
        }

        // Determine if the intent is allowed.
        let (allowed, reason_code) = if amount == 0 {
            (false, REASON_INVALID_AMOUNT)
        } else if policy.paused {
            (false, REASON_PAUSED)
        } else if policy.allowlist_enabled {
            match policy.allowed_recipient {
                Some(allowed_pk) if allowed_pk == ctx.accounts.recipient.key() => (true, REASON_OK),
                _ => (false, REASON_RECIPIENT_NOT_ALLOWED),
            }
        } else {
            (true, REASON_OK)
        };

        // Apply caps / cooldown / daily budget only if we haven't denied already.
        let (allowed, reason_code) = if !allowed {
            (allowed, reason_code)
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
        } else if policy.per_recipient_daily_cap_lamports > 0
            && recipient_spend
                .spent_today_lamports
                .checked_add(amount)
                .unwrap_or(u64::MAX)
                > policy.per_recipient_daily_cap_lamports
        {
            (false, REASON_RECIPIENT_CAP_EXCEEDED)
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
        audit.policy_version = policy.policy_version;

        // Advance sequence counter.
        policy.next_sequence = policy.next_sequence.checked_add(1).unwrap();

        // Execute transfer + update counters only when allowed.
        if allowed {
            policy.spent_today_lamports = policy.spent_today_lamports.checked_add(amount).unwrap();
            policy.last_spend_ts = clock.unix_timestamp;

            recipient_spend.spent_today_lamports = recipient_spend
                .spent_today_lamports
                .checked_add(amount)
                .unwrap();

            // Transfer SOL from vault PDA → recipient via direct lamport manipulation.
            let vault_info = ctx.accounts.vault.to_account_info();
            let recipient_info = ctx.accounts.recipient.to_account_info();
            **vault_info.try_borrow_mut_lamports()? = vault_info
                .lamports()
                .checked_sub(amount)
                .ok_or(ProgramError::InsufficientFunds)?;
            **recipient_info.try_borrow_mut_lamports()? =
                recipient_info.lamports().checked_add(amount).unwrap();
        }

        emit!(SpendRecorded {
            vault: ctx.accounts.vault.key(),
            policy: policy.key(),
            policy_version: policy.policy_version,
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

    /// E.3) Reclaim rent from a per-recipient spend tracker. Authority only.
    pub fn close_recipient_spend(ctx: Context<CloseRecipientSpend>) -> Result<()> {
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

    // ── advanced policy fields ──
    pub paused: bool,                          // 1
    pub allowlist_enabled: bool,               // 1
    pub allowed_recipient: Option<Pubkey>,     // 1 + 32 = 33
    pub per_recipient_daily_cap_lamports: u64, // 8
    pub policy_version: u16,                   // 2

    pub bump: u8, // 1
}

// 8 discriminator + (fields) = 195
// 32 + 32 + 33 + 8 + 8 + 8 + 4 + 8 + 8 + 1 + 1 + 33 + 8 + 2 + 1 = 187
// 8 + 187 = 195
impl Policy {
    pub const SIZE: usize = 8 + 32 + 32 + 33 + 8 + 8 + 8 + 4 + 8 + 8 + 1 + 1 + 33 + 8 + 2 + 1;
}

#[account]
pub struct AuditEvent {
    pub policy: Pubkey,     // 32
    pub sequence: u64,      // 8
    pub ts: i64,            // 8
    pub recipient: Pubkey,  // 32
    pub amount: u64,        // 8
    pub allowed: bool,      // 1
    pub reason_code: u16,   // 2
    pub policy_version: u16 // 2
}

// 8 + 32 + 8 + 8 + 32 + 8 + 1 + 2 + 2 = 101
impl AuditEvent {
    pub const SIZE: usize = 8 + 32 + 8 + 8 + 32 + 8 + 1 + 2 + 2;
}

#[account]
pub struct RecipientSpend {
    pub policy: Pubkey,            // 32
    pub recipient: Pubkey,         // 32
    pub spent_today_lamports: u64, // 8
    pub day_index: i64,            // 8
    pub bump: u8,                  // 1
}

// 8 + 32 + 32 + 8 + 8 + 1 = 89
impl RecipientSpend {
    pub const SIZE: usize = 8 + 32 + 32 + 8 + 8 + 1;
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
pub struct SpendIntentV2<'info> {
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
        init_if_needed,
        payer = caller,
        space = RecipientSpend::SIZE,
        seeds = [
            b"recipient",
            policy.key().as_ref(),
            recipient.key().as_ref(),
        ],
        bump,
    )]
    pub recipient_spend: Account<'info, RecipientSpend>,

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

#[derive(Accounts)]
pub struct CloseRecipientSpend<'info> {
    #[account(
        mut,
        close = authority,
        has_one = policy,
        seeds = [b"recipient", policy.key().as_ref(), recipient.key().as_ref()],
        bump = recipient_spend.bump,
    )]
    pub recipient_spend: Account<'info, RecipientSpend>,
    pub policy: Account<'info, Policy>,
    /// CHECK: Only used for PDA derivation.
    pub recipient: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

// ──────────────── Events ────────────────

#[event]
pub struct SpendRecorded {
    pub vault: Pubkey,
    pub policy: Pubkey,
    pub policy_version: u16,
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
