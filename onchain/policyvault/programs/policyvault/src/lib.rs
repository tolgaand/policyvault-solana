use anchor_lang::prelude::*;

declare_id!("GSzcBxsU64WAVqEFmjdbb8mp5xsz9a1jawZW1Z63z2GK");

#[program]
pub mod policyvault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
