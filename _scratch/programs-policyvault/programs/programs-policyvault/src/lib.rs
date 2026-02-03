use anchor_lang::prelude::*;

declare_id!("Em3rP8zzX1FXFKCs1AfyxBjQbKwP3CG6MEhzY9XczPja");

#[program]
pub mod programs_policyvault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
