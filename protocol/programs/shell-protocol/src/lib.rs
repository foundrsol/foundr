use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::{Instruction, AccountMeta}, program::invoke};
use anchor_spl::token::{self, Token, TokenAccount, Mint, TransferChecked, Burn};

declare_id!("CBZ5KvpvwfKphy1Mrrgsocey5KDimz47ajYmjNWVGWd6");
pub const VAULT_PROGRAM: Pubkey = pubkey!("H5dQjE5MxyTCcwVuDcrVH3yUTeP51t6CvBvg9T4FzPds");
pub const NATIVE_MINT: Pubkey = pubkey!("So11111111111111111111111111111111111111112");
pub const TIMELOCK: i64 = 3600;

#[program]
pub mod shell_protocol {
    use super::*;
    pub fn initialize(ctx: Context<Initialize>, admins: [Pubkey; 3], treasury_recipient: Pubkey, fees: Fees) -> Result<()> {
        require!(ctx.accounts.program_data.upgrade_authority_address == Some(ctx.accounts.authority.key()), ProtocolError::Unauthorized);
        require!(admins[0] == ctx.accounts.authority.key() && admins[0] != admins[1] && admins[0] != admins[2] && admins[1] != admins[2] && admins.iter().all(|p| *p != Pubkey::default()), ProtocolError::InvalidAdmins);
        fees.validate()?;
        require!(ctx.accounts.shell_mint.key() != ctx.accounts.quote_mint.key() && ctx.accounts.shell_mint.key() != NATIVE_MINT && ctx.accounts.quote_mint.key() != NATIVE_MINT, ProtocolError::WrongMint);
        require!(ctx.accounts.shell_mint.decimals <= 9 && ctx.accounts.quote_mint.decimals <= 9 && ctx.accounts.shell_mint.freeze_authority.is_none() && ctx.accounts.quote_mint.freeze_authority.is_none(), ProtocolError::WrongMint);
        let c = &mut ctx.accounts.config;
        c.admins = admins; c.treasury_recipient = treasury_recipient; c.vault_program = VAULT_PROGRAM;
        c.shell_mint = ctx.accounts.shell_mint.key(); c.quote_mint = ctx.accounts.quote_mint.key();
        c.fees = fees; c.revision = 1; c.bump = ctx.bumps.config;
        c.native_buyback = ctx.accounts.native_buyback.key(); c.native_treasury = ctx.accounts.native_treasury.key();
        c.spl_buyback = ctx.accounts.spl_buyback.key(); c.spl_treasury = ctx.accounts.spl_treasury.key(); c.burn_account = ctx.accounts.burn_account.key();
        c.test_pool_only = true; // Explicit controlled-test liquidity adapter, never a production DEX claim.
        ctx.accounts.native_treasury.config = c.key();
        Ok(())
    }

    pub fn propose_fees(ctx: Context<Admin>, fees: Fees) -> Result<()> {
        fees.validate()?;
        let c = &mut ctx.accounts.config; let i = c.admin_index(ctx.accounts.admin.key())?;
        require!(c.pending_at == 0, ProtocolError::PendingChange);
        c.pending_fees = fees; c.pending_at = Clock::get()?.unix_timestamp.checked_add(TIMELOCK).ok_or(ProtocolError::Overflow)?;
        c.pending_approvals = 1 << i;
        Ok(())
    }
    pub fn approve_fees(ctx: Context<Admin>) -> Result<()> {
        let c = &mut ctx.accounts.config; let i = c.admin_index(ctx.accounts.admin.key())?;
        require!(c.pending_at > 0, ProtocolError::NoPendingChange); c.pending_approvals |= 1 << i; Ok(())
    }
    pub fn activate_fees(ctx: Context<ActivateFees>) -> Result<()> {
        let c = &mut ctx.accounts.config;
        require!(c.pending_at > 0 && Clock::get()?.unix_timestamp >= c.pending_at, ProtocolError::Timelock);
        require!(c.pending_approvals.count_ones() >= 2, ProtocolError::Unauthorized);
        c.fees = c.pending_fees.clone(); c.revision = add(c.revision, 1)?; c.pending_at = 0; c.pending_approvals = 0; Ok(())
    }

    pub fn stage_authorization(ctx: Context<StageAuthorization>, signature: [u8; 768]) -> Result<()> {
        // Persist only a PUBLIC signature after the immutable core commitment.
        // Coordinator authorization prevents arbitrary callers poisoning this
        // permanent record. It still cannot authorize a vault withdrawal.
        let v = ctx.accounts.vault.try_borrow_data()?;
        require!(v.len() == 172 && v[0] == 1 && v[1] == 1, ProtocolError::InvalidOperation);
        require!(v[35..67] == ctx.accounts.coordinator.key().to_bytes(), ProtocolError::Unauthorized);
        let a = &mut ctx.accounts.authorization;
        a.vault = ctx.accounts.vault.key(); a.operation.copy_from_slice(&v[67..172]); a.signature = signature;
        Ok(())
    }

    pub fn paid_vault(ctx: Context<PaidVault>, service: u8, max_fee: u64, revision: u64) -> Result<()> {
        let operation = ctx.accounts.authorization.operation;
        let signature = &ctx.accounts.authorization.signature;
        require!(operation[0] == 1, ProtocolError::InvalidOperation);
        let amount = u64::from_le_bytes(operation[1..9].try_into().map_err(|_| ProtocolError::InvalidOperation)?);
        let c = &mut ctx.accounts.config; require!(c.revision == revision, ProtocolError::ConfigChanged);
        let fee = c.fees.quote(amount, service)?; require!(fee <= max_fee, ProtocolError::FeeCap);
        // The original vault alone verifies WOTS, the immutable operation and
        // all amount/recipient/change bindings. A fee-wallet signature is never
        // substituted for spending authorization. Everything rolls back on CPI failure.
        let mut data = Vec::with_capacity(874); data.push(3); data.extend_from_slice(&operation); data.extend_from_slice(signature);
        invoke(&Instruction { program_id: VAULT_PROGRAM, accounts: vec![
            AccountMeta::new(ctx.accounts.payer.key(), true), AccountMeta::new(ctx.accounts.vault.key(), false),
            AccountMeta::new(ctx.accounts.recipient.key(), false), AccountMeta::new(ctx.accounts.next_vault.key(), false),
            AccountMeta::new_readonly(System::id(), false),
        ], data }, &[
            ctx.accounts.payer.to_account_info(), ctx.accounts.vault.to_account_info(), ctx.accounts.recipient.to_account_info(),
            ctx.accounts.next_vault.to_account_info(), ctx.accounts.system_program.to_account_info(), ctx.accounts.vault_program.to_account_info(),
        ])?;
        let (buyback, treasury) = split(fee, c.fees.buyback_bps, &mut c.native_carry)?;
        pay_native(&ctx.accounts.payer, ctx.accounts.native_buyback.to_account_info(), &ctx.accounts.system_program, buyback)?;
        pay_native(&ctx.accounts.payer, ctx.accounts.native_treasury.to_account_info(), &ctx.accounts.system_program, treasury)?;
        c.native_volume = add(c.native_volume, amount)?; c.native_fees = add(c.native_fees, fee)?;
        c.native_allocated = add(c.native_allocated, buyback)?; c.native_treasury_allocated = add(c.native_treasury_allocated, treasury)?;
        ctx.accounts.receipt.fill(1, ctx.accounts.payer.key(), ctx.accounts.vault.key(), Pubkey::default(), amount, fee, buyback, treasury, revision, service)?;
        emit!(Payment { receipt: ctx.accounts.receipt.key(), asset: Pubkey::default(), amount, fee, buyback, treasury });
        Ok(())
    }

    pub fn pay_subscription(ctx: Context<PaySubscription>, nonce: [u8; 32], max_fee: u64, revision: u64) -> Result<()> {
        let c = &mut ctx.accounts.config; require!(c.revision == revision, ProtocolError::ConfigChanged);
        let fee = c.fees.subscription_price; require!(fee > 0 && fee <= max_fee && fee <= c.fees.max_fee_spl, ProtocolError::FeeCap);
        let (buyback, treasury) = split(fee, c.fees.buyback_bps, &mut c.spl_carry)?;
        token_move(ctx.accounts.payer_quote.to_account_info(), ctx.accounts.spl_buyback.to_account_info(), ctx.accounts.quote_mint.to_account_info(), ctx.accounts.payer.to_account_info(), &[], buyback, ctx.accounts.quote_mint.decimals)?;
        token_move(ctx.accounts.payer_quote.to_account_info(), ctx.accounts.spl_treasury.to_account_info(), ctx.accounts.quote_mint.to_account_info(), ctx.accounts.payer.to_account_info(), &[], treasury, ctx.accounts.quote_mint.decimals)?;
        c.spl_fees = add(c.spl_fees, fee)?;
        c.spl_allocated = add(c.spl_allocated, buyback)?; c.spl_treasury_allocated = add(c.spl_treasury_allocated, treasury)?;
        ctx.accounts.receipt.fill(2, ctx.accounts.payer.key(), Pubkey::new_from_array(nonce), c.quote_mint, 0, fee, buyback, treasury, revision, 5)?;
        ctx.accounts.receipt.expires_at = Clock::get()?.unix_timestamp.checked_add(2_592_000).ok_or(ProtocolError::Overflow)?;
        emit!(Payment { receipt: ctx.accounts.receipt.key(), asset: c.quote_mint, amount: 0, fee, buyback, treasury });
        Ok(())
    }

    pub fn create_test_pool(ctx: Context<CreatePool>, quote_amount: u64, shell_amount: u64) -> Result<()> {
        ctx.accounts.config.check_multisig(ctx.remaining_accounts, Some(ctx.accounts.admin.key()))?;
        require!(ctx.accounts.config.test_pool_only && quote_amount > 0 && shell_amount > 0, ProtocolError::InvalidPool);
        let quote = ctx.accounts.quote_mint.key(); require!(quote == NATIVE_MINT || quote == ctx.accounts.config.quote_mint, ProtocolError::WrongMint);
        let p = &mut ctx.accounts.pool; p.config = ctx.accounts.config.key(); p.quote_mint = quote; p.shell_mint = ctx.accounts.shell_mint.key();
        p.quote_account = ctx.accounts.pool_quote.key(); p.shell_account = ctx.accounts.pool_shell.key(); p.bump = ctx.bumps.pool;
        token_move(ctx.accounts.admin_quote.to_account_info(), ctx.accounts.pool_quote.to_account_info(), ctx.accounts.quote_mint.to_account_info(), ctx.accounts.admin.to_account_info(), &[], quote_amount, ctx.accounts.quote_mint.decimals)?;
        token_move(ctx.accounts.admin_shell.to_account_info(), ctx.accounts.pool_shell.to_account_info(), ctx.accounts.shell_mint.to_account_info(), ctx.accounts.admin.to_account_info(), &[], shell_amount, ctx.accounts.shell_mint.decimals)?;
        Ok(())
    }

    pub fn settle(ctx: Context<Settle>, nonce: u64, amount: u64, minimum_out: u64, deadline: i64) -> Result<()> {
        let c = &mut ctx.accounts.config; let now = Clock::get()?.unix_timestamp;
        require!(c.test_pool_only && nonce == c.settlement_nonce, ProtocolError::Replay);
        require!(deadline >= now && deadline <= now.checked_add(120).ok_or(ProtocolError::Overflow)?, ProtocolError::ExpiredQuote);
        let native = ctx.accounts.quote_mint.key() == NATIVE_MINT;
        require!(native || ctx.accounts.quote_mint.key() == c.quote_mint, ProtocolError::WrongMint);
        let fees = &c.fees;
        let max = if native { fees.max_settle_native } else { fees.max_settle_spl };
        let minimum_liquidity = if native { fees.min_liquidity_native } else { fees.min_liquidity_spl };
        let remaining = if native { c.native_allocated.checked_sub(c.native_spent) } else { c.spl_allocated.checked_sub(c.spl_spent) }.ok_or(ProtocolError::Overflow)?;
        require!(amount <= remaining, ProtocolError::InsufficientFunds);
        require!(amount > 0 && amount <= max && ctx.accounts.pool_quote.amount >= minimum_liquidity && ctx.accounts.pool_shell.amount > 0, ProtocolError::InsufficientLiquidity);
        let (out, floor) = swap_quote(amount, ctx.accounts.pool_quote.amount, ctx.accounts.pool_shell.amount, fees.max_impact_bps, fees.max_slippage_bps)?;
        require!(minimum_out >= floor && out >= minimum_out && out > 0, ProtocolError::InvalidQuote);
        let config_key = c.key(); let bump = [c.bump]; let seeds: &[&[u8]] = &[b"config", &bump];
        if native {
            let remaining = ctx.accounts.native_buyback.lamports().checked_sub(amount).ok_or(ProtocolError::InsufficientFunds)?;
            require!(remaining >= Rent::get()?.minimum_balance(0), ProtocolError::InsufficientFunds);
            // System-owned, data-free PDA: only these fixed seeds can sign.
            // Transfer through System CPI, then use the standard one-account
            // SyncNative CPI. No direct lamport edits across token CPIs.
            let native_bump = [ctx.bumps.native_buyback]; let native_seeds: &[&[u8]] = &[b"native-buyback", config_key.as_ref(), &native_bump];
            anchor_lang::system_program::transfer(CpiContext::new_with_signer(System::id(), anchor_lang::system_program::Transfer { from: ctx.accounts.native_buyback.to_account_info(), to: ctx.accounts.pool_quote.to_account_info() }, &[native_seeds]), amount)?;
            token::sync_native(CpiContext::new(Token::id(), token::SyncNative { account: ctx.accounts.pool_quote.to_account_info() }))?;
        } else {
            token_move(ctx.accounts.spl_buyback.to_account_info(), ctx.accounts.pool_quote.to_account_info(), ctx.accounts.quote_mint.to_account_info(), c.to_account_info(), &[seeds], amount, ctx.accounts.quote_mint.decimals)?;
        }
        let pool_bump = [ctx.accounts.pool.bump]; let quote_key = ctx.accounts.quote_mint.key();
        let pool_seeds: &[&[u8]] = &[b"pool", config_key.as_ref(), quote_key.as_ref(), &pool_bump];
        token_move(ctx.accounts.pool_shell.to_account_info(), ctx.accounts.burn_account.to_account_info(), ctx.accounts.shell_mint.to_account_info(), ctx.accounts.pool.to_account_info(), &[pool_seeds], out, ctx.accounts.shell_mint.decimals)?;
        token::burn(CpiContext::new_with_signer(Token::id(), Burn { mint: ctx.accounts.shell_mint.to_account_info(), from: ctx.accounts.burn_account.to_account_info(), authority: c.to_account_info() }, &[seeds]), out)?;
        c.settlement_nonce = add(c.settlement_nonce, 1)?;
        if native { c.native_spent = add(c.native_spent, amount)?; c.native_bought = add(c.native_bought, out)?; }
        else { c.spl_spent = add(c.spl_spent, amount)?; c.spl_bought = add(c.spl_bought, out)?; }
        c.burned = add(c.burned, out)?;
        ctx.accounts.receipt.fill(3, ctx.accounts.keeper.key(), ctx.accounts.pool.key(), quote_key, amount, 0, 0, 0, c.revision, 0)?;
        ctx.accounts.receipt.bought = out; ctx.accounts.receipt.burned = out;
        emit!(Settlement { receipt: ctx.accounts.receipt.key(), asset: quote_key, input: amount, bought: out, burned: out });
        Ok(())
    }

    pub fn release_treasury(ctx: Context<ReleaseTreasury>, nonce: u64, amount: u64) -> Result<()> {
        let c = &mut ctx.accounts.config; c.check_multisig(ctx.remaining_accounts, c.admins.contains(&ctx.accounts.payer.key()).then_some(ctx.accounts.payer.key()))?;
        require!(nonce == c.treasury_nonce && amount > 0, ProtocolError::Replay);
        require!(amount <= c.native_treasury_allocated.checked_sub(c.treasury_released).ok_or(ProtocolError::Overflow)?, ProtocolError::InsufficientFunds);
        debit_native(&ctx.accounts.native_treasury.to_account_info(), &ctx.accounts.recipient.to_account_info(), amount)?;
        c.treasury_nonce = add(c.treasury_nonce, 1)?; c.treasury_released = add(c.treasury_released, amount)?;
        ctx.accounts.receipt.fill(4, ctx.accounts.payer.key(), ctx.accounts.recipient.key(), Pubkey::default(), amount, 0, 0, 0, c.revision, 0)?; Ok(())
    }

    pub fn release_spl_treasury(ctx: Context<ReleaseSplTreasury>, nonce: u64, amount: u64) -> Result<()> {
        let c = &mut ctx.accounts.config; c.check_multisig(ctx.remaining_accounts, c.admins.contains(&ctx.accounts.payer.key()).then_some(ctx.accounts.payer.key()))?;
        require!(nonce == c.spl_treasury_nonce && amount > 0, ProtocolError::Replay);
        require!(amount <= c.spl_treasury_allocated.checked_sub(c.spl_treasury_released).ok_or(ProtocolError::Overflow)?, ProtocolError::InsufficientFunds);
        let bump = [c.bump]; let seeds: &[&[u8]] = &[b"config", &bump];
        token_move(ctx.accounts.spl_treasury.to_account_info(), ctx.accounts.recipient_quote.to_account_info(), ctx.accounts.quote_mint.to_account_info(), c.to_account_info(), &[seeds], amount, ctx.accounts.quote_mint.decimals)?;
        c.spl_treasury_nonce = add(c.spl_treasury_nonce, 1)?; c.spl_treasury_released = add(c.spl_treasury_released, amount)?;
        ctx.accounts.receipt.fill(4, ctx.accounts.payer.key(), ctx.accounts.recipient_quote.key(), c.quote_mint, amount, 0, 0, 0, c.revision, 0)?; Ok(())
    }

    pub fn register_operator(ctx: Context<RegisterOperator>, amount: u64) -> Result<()> {
        require!(amount >= ctx.accounts.config.fees.minimum_stake, ProtocolError::Ineligible);
        let o = &mut ctx.accounts.operator; o.owner = ctx.accounts.owner.key(); o.config = ctx.accounts.config.key(); o.staked = amount; o.bump = ctx.bumps.operator;
        o.unlock_at = Clock::get()?.unix_timestamp.checked_add(ctx.accounts.config.fees.operator_lock_seconds as i64).ok_or(ProtocolError::Overflow)?;
        token_move(ctx.accounts.owner_shell.to_account_info(), ctx.accounts.stake_vault.to_account_info(), ctx.accounts.shell_mint.to_account_info(), ctx.accounts.owner.to_account_info(), &[], amount, ctx.accounts.shell_mint.decimals)?;
        Ok(())
    }
    pub fn stake(ctx: Context<Stake>, amount: u64, nonce: u64) -> Result<()> {
        require!(amount > 0, ProtocolError::InvalidOperation);
        let o = &mut ctx.accounts.operator; require!(nonce == o.action_nonce, ProtocolError::Replay); o.action_nonce = add(o.action_nonce, 1)?; o.staked = add(o.staked, amount)?;
        o.unlock_at = o.unlock_at.max(Clock::get()?.unix_timestamp.checked_add(ctx.accounts.config.fees.operator_lock_seconds as i64).ok_or(ProtocolError::Overflow)?);
        token_move(ctx.accounts.owner_shell.to_account_info(), ctx.accounts.stake_vault.to_account_info(), ctx.accounts.shell_mint.to_account_info(), ctx.accounts.owner.to_account_info(), &[], amount, ctx.accounts.shell_mint.decimals)?; Ok(())
    }
    pub fn unstake(ctx: Context<Stake>, amount: u64, nonce: u64) -> Result<()> {
        let o = &mut ctx.accounts.operator; require!(nonce == o.action_nonce, ProtocolError::Replay); require!(Clock::get()?.unix_timestamp >= o.unlock_at, ProtocolError::Timelock); o.action_nonce = add(o.action_nonce, 1)?;
        require!(amount > 0 && amount <= o.staked, ProtocolError::InsufficientFunds);
        let cfg = ctx.accounts.config.key(); let owner = o.owner; let bump = [o.bump]; let seeds: &[&[u8]] = &[b"operator", cfg.as_ref(), owner.as_ref(), &bump];
        token_move(ctx.accounts.stake_vault.to_account_info(), ctx.accounts.owner_shell.to_account_info(), ctx.accounts.shell_mint.to_account_info(), o.to_account_info(), &[seeds], amount, ctx.accounts.shell_mint.decimals)?;
        o.staked -= amount; Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace, Default)]
pub struct Fees {
    pub rates_bps: [u16; 3], pub buyback_bps: u16, pub max_fee_native: u64, pub max_fee_spl: u64, pub subscription_price: u64,
    pub max_impact_bps: u16, pub max_slippage_bps: u16, pub max_settle_native: u64, pub max_settle_spl: u64,
    pub min_liquidity_native: u64, pub min_liquidity_spl: u64,
    pub minimum_stake: u64, pub operator_lock_seconds: u32,
}
impl Fees {
    fn validate(&self) -> Result<()> {
        require!(self.rates_bps.iter().all(|v| *v <= 100) && self.buyback_bps <= 10000 && self.max_fee_native > 0 && self.max_fee_spl > 0 && self.subscription_price > 0 && self.subscription_price <= self.max_fee_spl && self.max_impact_bps <= 500 && self.max_slippage_bps <= 200 && self.max_settle_native > 0 && self.max_settle_spl > 0 && self.min_liquidity_native > 0 && self.min_liquidity_spl > 0 && self.minimum_stake > 0 && self.operator_lock_seconds >= 3600 && self.operator_lock_seconds <= 7_776_000, ProtocolError::InvalidConfig); Ok(())
    }
    fn quote(&self, amount: u64, service: u8) -> Result<u64> {
        require!(amount > 0, ProtocolError::InvalidOperation);
        let bps = match service { 1 => self.rates_bps[0], 2 => self.rates_bps[1], 3 => self.rates_bps[2], 4 => self.rates_bps[1].checked_add(self.rates_bps[2]).ok_or(ProtocolError::Overflow)?, _ => return err!(ProtocolError::InvalidOperation) };
        Ok(u64::try_from((amount as u128 * bps as u128 + 9999) / 10000).map_err(|_| ProtocolError::Overflow)?.min(self.max_fee_native))
    }
}
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admins: [Pubkey; 3], pub treasury_recipient: Pubkey, pub vault_program: Pubkey, pub shell_mint: Pubkey, pub quote_mint: Pubkey,
    pub native_buyback: Pubkey, pub native_treasury: Pubkey, pub spl_buyback: Pubkey, pub spl_treasury: Pubkey, pub burn_account: Pubkey,
    pub fees: Fees, pub pending_fees: Fees, pub pending_at: i64, pub pending_approvals: u8, pub revision: u64, pub bump: u8, pub test_pool_only: bool,
    pub native_volume: u64, pub native_fees: u64, pub native_carry: u16, pub spl_fees: u64, pub spl_carry: u16,
    pub native_spent: u64, pub spl_spent: u64, pub native_bought: u64, pub spl_bought: u64, pub burned: u64,
    pub native_allocated: u64, pub spl_allocated: u64, pub native_treasury_allocated: u64, pub spl_treasury_allocated: u64,
    pub settlement_nonce: u64, pub treasury_nonce: u64, pub treasury_released: u64,
    pub spl_treasury_nonce: u64, pub spl_treasury_released: u64,
}
impl Config {
    fn admin_index(&self, key: Pubkey) -> Result<usize> { self.admins.iter().position(|k| *k == key).ok_or_else(|| error!(ProtocolError::Unauthorized)) }
    fn check_multisig(&self, accounts: &[AccountInfo], initial: Option<Pubkey>) -> Result<()> {
        let mut mask = 0u8; if let Some(key) = initial { mask |= 1 << self.admin_index(key)?; }
        for a in accounts { if a.is_signer { if let Ok(i) = self.admin_index(a.key()) { mask |= 1 << i; } } }
        require!(mask.count_ones() >= 2, ProtocolError::Unauthorized); Ok(())
    }
}
#[account]
#[derive(InitSpace)]
pub struct Bank { pub config: Pubkey }
#[account]
#[derive(InitSpace)]
pub struct Pool { pub config: Pubkey, pub quote_mint: Pubkey, pub shell_mint: Pubkey, pub quote_account: Pubkey, pub shell_account: Pubkey, pub bump: u8 }
#[account]
#[derive(InitSpace)]
pub struct Operator { pub owner: Pubkey, pub config: Pubkey, pub staked: u64, pub unlock_at: i64, pub action_nonce: u64, pub bump: u8 }
#[account]
#[derive(InitSpace)]
pub struct Receipt {
    pub kind: u8, pub payer: Pubkey, pub operation: Pubkey, pub asset: Pubkey, pub amount: u64, pub fee: u64, pub buyback: u64, pub treasury: u64,
    pub revision: u64, pub service: u8, pub timestamp: i64, pub expires_at: i64, pub bought: u64, pub burned: u64,
}
#[account]
#[derive(InitSpace)]
pub struct Authorization { pub vault: Pubkey, pub operation: [u8; 105], pub signature: [u8; 768] }
impl Receipt {
    fn fill(&mut self, kind: u8, payer: Pubkey, operation: Pubkey, asset: Pubkey, amount: u64, fee: u64, buyback: u64, treasury: u64, revision: u64, service: u8) -> Result<()> {
        self.kind = kind; self.payer = payer; self.operation = operation; self.asset = asset; self.amount = amount; self.fee = fee; self.buyback = buyback; self.treasury = treasury; self.revision = revision; self.service = service; self.timestamp = Clock::get()?.unix_timestamp; Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)] pub authority: Signer<'info>,
    #[account(address = crate::ID, constraint = protocol.programdata_address()? == Some(program_data.key()) @ ProtocolError::Unauthorized)] pub protocol: Program<'info, crate::program::ShellProtocol>,
    pub program_data: Box<Account<'info, ProgramData>>,
    #[account(init, payer = authority, seeds = [b"config"], bump, space = 8 + Config::INIT_SPACE)] pub config: Box<Account<'info, Config>>,
    /// CHECK: Created as a data-free System-owned PDA; only this program derives its signing seeds.
    #[account(init, payer = authority, seeds = [b"native-buyback", config.key().as_ref()], bump, space = 0, owner = System::id())] pub native_buyback: UncheckedAccount<'info>,
    #[account(init, payer = authority, seeds = [b"native-treasury", config.key().as_ref()], bump, space = 8 + Bank::INIT_SPACE)] pub native_treasury: Box<Account<'info, Bank>>,
    pub shell_mint: Box<Account<'info, Mint>>, pub quote_mint: Box<Account<'info, Mint>>,
    #[account(init, payer = authority, seeds = [b"spl-buyback", config.key().as_ref()], bump, token::mint = quote_mint, token::authority = config)] pub spl_buyback: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = authority, seeds = [b"spl-treasury", config.key().as_ref()], bump, token::mint = quote_mint, token::authority = config)] pub spl_treasury: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = authority, seeds = [b"burn", config.key().as_ref()], bump, token::mint = shell_mint, token::authority = config)] pub burn_account: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>, pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Admin<'info> { pub admin: Signer<'info>, #[account(mut, seeds = [b"config"], bump = config.bump)] pub config: Box<Account<'info, Config>> }
#[derive(Accounts)]
pub struct ActivateFees<'info> { #[account(mut, seeds = [b"config"], bump = config.bump)] pub config: Box<Account<'info, Config>> }
#[derive(Accounts)]
pub struct StageAuthorization<'info> {
    #[account(mut)] pub payer: Signer<'info>, pub coordinator: Signer<'info>,
    /// CHECK: Exact pinned core program owner and committed data layout checked in handler.
    #[account(owner = VAULT_PROGRAM)] pub vault: UncheckedAccount<'info>,
    #[account(init, payer = payer, seeds = [b"authorization", vault.key().as_ref()], bump, space = 8 + Authorization::INIT_SPACE)] pub authorization: Box<Account<'info, Authorization>>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct PaidVault<'info> {
    #[account(mut)] pub payer: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)] pub config: Box<Account<'info, Config>>,
    #[account(mut, address = config.native_buyback, seeds = [b"native-buyback", config.key().as_ref()], bump)] pub native_buyback: SystemAccount<'info>,
    #[account(mut, address = config.native_treasury, has_one = config)] pub native_treasury: Box<Account<'info, Bank>>,
    #[account(init, payer = payer, seeds = [b"receipt", vault.key().as_ref()], bump, space = 8 + Receipt::INIT_SPACE)] pub receipt: Box<Account<'info, Receipt>>,
    #[account(seeds = [b"authorization", vault.key().as_ref()], bump, has_one = vault)] pub authorization: Box<Account<'info, Authorization>>,
    /// CHECK: Original pinned vault program validates its PDA, owner, state and WOTS authorization.
    #[account(mut, owner = VAULT_PROGRAM)] pub vault: UncheckedAccount<'info>,
    /// CHECK: WOTS operation binds this recipient; duplicate payer recipient is explicitly supported.
    #[account(mut, dup)] pub recipient: UncheckedAccount<'info>,
    /// CHECK: Original pinned vault program validates the next PDA and root.
    #[account(mut)] pub next_vault: UncheckedAccount<'info>,
    /// CHECK: Exact original program; no caller-selected CPI target.
    #[account(address = VAULT_PROGRAM, executable)] pub vault_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(nonce: [u8; 32])]
pub struct PaySubscription<'info> {
    #[account(mut)] pub payer: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)] pub config: Box<Account<'info, Config>>,
    #[account(address = config.quote_mint)] pub quote_mint: Box<Account<'info, Mint>>,
    #[account(mut, token::mint = quote_mint, token::authority = payer)] pub payer_quote: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = config.spl_buyback, token::mint = quote_mint, token::authority = config)] pub spl_buyback: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = config.spl_treasury, token::mint = quote_mint, token::authority = config)] pub spl_treasury: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = payer, seeds = [b"subscription-receipt", payer.key().as_ref(), &nonce], bump, space = 8 + Receipt::INIT_SPACE)] pub receipt: Box<Account<'info, Receipt>>,
    pub token_program: Program<'info, Token>, pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct CreatePool<'info> {
    #[account(mut)] pub admin: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)] pub config: Box<Account<'info, Config>>,
    pub quote_mint: Box<Account<'info, Mint>>, #[account(address = config.shell_mint)] pub shell_mint: Box<Account<'info, Mint>>,
    #[account(init, payer = admin, seeds = [b"pool", config.key().as_ref(), quote_mint.key().as_ref()], bump, space = 8 + Pool::INIT_SPACE)] pub pool: Box<Account<'info, Pool>>,
    #[account(init, payer = admin, seeds = [b"pool-quote", pool.key().as_ref()], bump, token::mint = quote_mint, token::authority = pool)] pub pool_quote: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = admin, seeds = [b"pool-shell", pool.key().as_ref()], bump, token::mint = shell_mint, token::authority = pool)] pub pool_shell: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = quote_mint, token::authority = admin)] pub admin_quote: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = shell_mint, token::authority = admin)] pub admin_shell: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>, pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct Settle<'info> {
    #[account(mut)] pub keeper: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)] pub config: Box<Account<'info, Config>>,
    #[account(mut, address = config.native_buyback, seeds = [b"native-buyback", config.key().as_ref()], bump)] pub native_buyback: SystemAccount<'info>,
    #[account(mut, address = config.spl_buyback, token::mint = config.quote_mint, token::authority = config)] pub spl_buyback: Box<Account<'info, TokenAccount>>,
    pub quote_mint: Box<Account<'info, Mint>>, #[account(mut, address = config.shell_mint)] pub shell_mint: Box<Account<'info, Mint>>,
    #[account(seeds = [b"pool", config.key().as_ref(), quote_mint.key().as_ref()], bump = pool.bump, has_one = config, has_one = quote_mint, has_one = shell_mint)] pub pool: Box<Account<'info, Pool>>,
    #[account(mut, address = pool.quote_account, token::mint = quote_mint, token::authority = pool)] pub pool_quote: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = pool.shell_account, token::mint = shell_mint, token::authority = pool)] pub pool_shell: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = config.burn_account, token::mint = shell_mint, token::authority = config)] pub burn_account: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = keeper, seeds = [b"settlement", config.key().as_ref(), &nonce.to_le_bytes()], bump, space = 8 + Receipt::INIT_SPACE)] pub receipt: Box<Account<'info, Receipt>>,
    pub token_program: Program<'info, Token>, pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct ReleaseTreasury<'info> {
    #[account(mut)] pub payer: Signer<'info>, #[account(mut, seeds = [b"config"], bump = config.bump)] pub config: Box<Account<'info, Config>>,
    #[account(mut, address = config.native_treasury, has_one = config)] pub native_treasury: Box<Account<'info, Bank>>,
    /// CHECK: Immutable treasury recipient. Two distinct administrators must authorize every release.
    #[account(mut, dup, address = config.treasury_recipient)] pub recipient: UncheckedAccount<'info>,
    #[account(init, payer = payer, seeds = [b"treasury-receipt", config.key().as_ref(), &nonce.to_le_bytes()], bump, space = 8 + Receipt::INIT_SPACE)] pub receipt: Box<Account<'info, Receipt>>,
    pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct ReleaseSplTreasury<'info> {
    #[account(mut)] pub payer: Signer<'info>, #[account(mut, seeds = [b"config"], bump = config.bump)] pub config: Box<Account<'info, Config>>,
    #[account(address = config.quote_mint)] pub quote_mint: Box<Account<'info, Mint>>,
    #[account(mut, address = config.spl_treasury, token::mint = quote_mint, token::authority = config)] pub spl_treasury: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = quote_mint, constraint = recipient_quote.owner == config.treasury_recipient @ ProtocolError::Unauthorized)] pub recipient_quote: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = payer, seeds = [b"spl-treasury-receipt", config.key().as_ref(), &nonce.to_le_bytes()], bump, space = 8 + Receipt::INIT_SPACE)] pub receipt: Box<Account<'info, Receipt>>,
    pub token_program: Program<'info, Token>, pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct RegisterOperator<'info> {
    #[account(mut)] pub owner: Signer<'info>, #[account(seeds = [b"config"], bump = config.bump)] pub config: Box<Account<'info, Config>>,
    #[account(address = config.shell_mint)] pub shell_mint: Box<Account<'info, Mint>>,
    #[account(init, payer = owner, seeds = [b"operator", config.key().as_ref(), owner.key().as_ref()], bump, space = 8 + Operator::INIT_SPACE)] pub operator: Box<Account<'info, Operator>>,
    #[account(init, payer = owner, seeds = [b"stake-vault", operator.key().as_ref()], bump, token::mint = shell_mint, token::authority = operator)] pub stake_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = shell_mint, token::authority = owner)] pub owner_shell: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>, pub system_program: Program<'info, System>,
}
#[derive(Accounts)]
pub struct Stake<'info> {
    pub owner: Signer<'info>, #[account(seeds = [b"config"], bump = config.bump)] pub config: Box<Account<'info, Config>>,
    #[account(address = config.shell_mint)] pub shell_mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [b"operator", config.key().as_ref(), owner.key().as_ref()], bump = operator.bump, has_one = owner, has_one = config)] pub operator: Box<Account<'info, Operator>>,
    #[account(mut, seeds = [b"stake-vault", operator.key().as_ref()], bump, token::mint = shell_mint, token::authority = operator)] pub stake_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = shell_mint, token::authority = owner)] pub owner_shell: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

fn add(a: u64, b: u64) -> Result<u64> { a.checked_add(b).ok_or_else(|| error!(ProtocolError::Overflow)) }
fn split(fee: u64, bps: u16, carry: &mut u16) -> Result<(u64,u64)> {
    let scaled = (fee as u128).checked_mul(bps as u128).and_then(|n| n.checked_add(*carry as u128)).ok_or(ProtocolError::Overflow)?;
    let buyback = u64::try_from(scaled / 10000).map_err(|_| ProtocolError::Overflow)?; *carry = (scaled % 10000) as u16;
    Ok((buyback, fee.checked_sub(buyback).ok_or(ProtocolError::Overflow)?))
}
fn pay_native<'info>(payer: &Signer<'info>, bank: AccountInfo<'info>, system: &Program<'info, System>, amount: u64) -> Result<()> {
    if amount > 0 { anchor_lang::system_program::transfer(CpiContext::new(system.key(), anchor_lang::system_program::Transfer { from: payer.to_account_info(), to: bank }), amount)?; } Ok(())
}
fn debit_native(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    let minimum = Rent::get()?.minimum_balance(from.data_len()); let remaining = from.lamports().checked_sub(amount).ok_or(ProtocolError::InsufficientFunds)?;
    require!(remaining >= minimum, ProtocolError::InsufficientFunds);
    let target = add(to.lamports(), amount)?; **from.try_borrow_mut_lamports()? = remaining; **to.try_borrow_mut_lamports()? = target; Ok(())
}
fn token_move<'info>(from: AccountInfo<'info>, to: AccountInfo<'info>, mint: AccountInfo<'info>, authority: AccountInfo<'info>, seeds: &[&[&[u8]]], amount: u64, decimals: u8) -> Result<()> {
    if amount > 0 { token::transfer_checked(CpiContext::new_with_signer(Token::id(), TransferChecked { from, to, mint, authority }, seeds), amount, decimals)?; } Ok(())
}
fn swap_quote(amount: u64, x: u64, y: u64, impact: u16, slippage: u16) -> Result<(u64,u64)> {
    require!(x > 0 && y > 0 && amount > 0, ProtocolError::InsufficientLiquidity);
    let a = amount as u128 * 9970; let out = a.checked_mul(y as u128).ok_or(ProtocolError::Overflow)? / ((x as u128 * 10000).checked_add(a).ok_or(ProtocolError::Overflow)?);
    let ideal = a.checked_mul(y as u128).ok_or(ProtocolError::Overflow)? / (x as u128 * 10000);
    require!(ideal > 0 && ideal.checked_sub(out).ok_or(ProtocolError::InvalidQuote)?.checked_mul(10000).ok_or(ProtocolError::Overflow)? <= ideal.checked_mul(impact as u128).ok_or(ProtocolError::Overflow)?, ProtocolError::PriceImpact);
    let out = u64::try_from(out).map_err(|_| ProtocolError::Overflow)?;
    let floor = u64::try_from((out as u128 * (10000 - slippage as u128) + 9999) / 10000).map_err(|_| ProtocolError::Overflow)?;
    Ok((out, floor))
}
#[event]
pub struct Payment { pub receipt: Pubkey, pub asset: Pubkey, pub amount: u64, pub fee: u64, pub buyback: u64, pub treasury: u64 }
#[event]
pub struct Settlement { pub receipt: Pubkey, pub asset: Pubkey, pub input: u64, pub bought: u64, pub burned: u64 }
#[error_code]
pub enum ProtocolError {
    #[msg("Two distinct configured administrators must authorize this action")] Unauthorized,
    #[msg("Administrator keys must be distinct and nonzero")] InvalidAdmins,
    #[msg("Invalid fee configuration or limits")] InvalidConfig,
    #[msg("A configuration change is already pending")] PendingChange,
    #[msg("No configuration change is pending")] NoPendingChange,
    #[msg("The public lock period has not elapsed")] Timelock,
    #[msg("Operation or service is invalid")] InvalidOperation,
    #[msg("Quoted configuration revision changed; review again")] ConfigChanged,
    #[msg("Fee exceeds the explicitly approved maximum")] FeeCap,
    #[msg("Incorrect mint or unsupported token authority")] WrongMint,
    #[msg("Arithmetic overflow")] Overflow,
    #[msg("The controlled test pool is invalid")] InvalidPool,
    #[msg("Settlement nonce was consumed")] Replay,
    #[msg("Quote expired or exceeds its validity window")] ExpiredQuote,
    #[msg("Insufficient real on-chain pool liquidity")] InsufficientLiquidity,
    #[msg("Quote output or minimum output is invalid")] InvalidQuote,
    #[msg("Price impact exceeds the configured maximum")] PriceImpact,
    #[msg("Insufficient spendable balance after preserving rent")] InsufficientFunds,
    #[msg("Stake does not meet the public eligibility requirement")] Ineligible,
}
