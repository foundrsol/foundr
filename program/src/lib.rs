//! SHELL SOL-only adaptation. Upstream Winternitz verifier is unchanged.
//! The mainnet-v2 build has a separate authorization domain and account version.
//! No ordinary signer, closure, recovery or administrator instruction spends
//! vault SOL. Permanent records prevent replay/reinitialization and gate signing
//! safely from stale encrypted backups. This prototype is NOT audited.
#![cfg_attr(any(target_os = "solana", target_arch = "bpf"), no_std)]
use pinocchio::{AccountView, Address, ProgramResult, error::ProgramError,
    cpi::{Seed, Signer}, sysvars::{Sysvar, rent::Rent}, program_entrypoint};
use pinocchio_system::instructions::{CreateAccount, Transfer, Allocate, Assign};
use winterwallet_core::{WinternitzRoot, WinternitzSignature};

#[cfg(any(target_os = "solana", target_arch = "bpf"))]
pinocchio::nostd_panic_handler!();
#[cfg(any(target_os = "solana", target_arch = "bpf"))]
pinocchio::no_allocator!();
program_entrypoint!(process_instruction);

pub const LEN: usize = 172;
pub const OP_LEN: usize = 105;
pub const SIGNATURE_LEN: usize = 768;
#[cfg(not(feature = "mainnet-v2"))]
pub const DOMAIN: &[u8] = b"SHELL_DEVNET_V1";
#[cfg(not(feature = "mainnet-v2"))]
pub const NETWORK_DOMAIN: &[u8] = b"EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
#[cfg(not(feature = "mainnet-v2"))]
pub const ACCOUNT_VERSION: u8 = 1;
#[cfg(feature = "mainnet-v2")]
pub const DOMAIN: &[u8] = b"SHELL_MAINNET_V2";
#[cfg(feature = "mainnet-v2")]
pub const NETWORK_DOMAIN: &[u8] = b"5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
#[cfg(feature = "mainnet-v2")]
pub const ACCOUNT_VERSION: u8 = 2;
const SEED: &[u8] = b"shell";
const AVAILABLE: u8 = 0;
const COMMITTED: u8 = 1;
const CONSUMED: u8 = 2;

fn fixed<const N: usize>(bytes: &[u8]) -> Result<[u8; N], ProgramError> {
    bytes.try_into().map_err(|_| ProgramError::InvalidInstructionData)
}
fn state(program: &Address, vault: &AccountView) -> Result<[u8; LEN], ProgramError> {
    if !vault.owned_by(program) || vault.data_len() != LEN { return Err(ProgramError::InvalidAccountOwner); }
    let data = fixed::<LEN>(&vault.try_borrow()?)?;
    if data[0] != ACCOUNT_VERSION || data[1] > CONSUMED { return Err(ProgramError::InvalidAccountData); }
    let (address, bump) = Address::derive_program_address(&[SEED, &data[3..35], &data[35..67]], program).ok_or(ProgramError::InvalidSeeds)?;
    if &address != vault.address() || bump != data[2] { return Err(ProgramError::InvalidSeeds); }
    Ok(data)
}
fn write(vault: &mut AccountView, bytes: &[u8; LEN]) -> ProgramResult {
    vault.try_borrow_mut()?.copy_from_slice(bytes); Ok(())
}
fn signer(account: &AccountView) -> ProgramResult {
    if !account.is_signer() { return Err(ProgramError::MissingRequiredSignature); } Ok(())
}
fn system(account: &AccountView) -> ProgramResult {
    if account.address() != &pinocchio_system::ID || !account.executable() { return Err(ProgramError::IncorrectProgramId); } Ok(())
}
fn create_vault(program: &Address, payer: &AccountView, vault: &mut AccountView, root: &[u8;32], coordinator: &[u8;32]) -> ProgramResult {
    signer(payer)?;
    if !vault.owned_by(&pinocchio_system::ID) || vault.data_len() != 0 { return Err(ProgramError::AccountAlreadyInitialized); }
    if root == &[0;32] { return Err(ProgramError::InvalidArgument); }
    let (address, bump) = Address::derive_program_address(&[SEED, root, coordinator], program).ok_or(ProgramError::InvalidSeeds)?;
    if &address != vault.address() { return Err(ProgramError::InvalidSeeds); }
    let bump_bytes = [bump];
    let seeds = [Seed::from(SEED), Seed::from(root), Seed::from(coordinator), Seed::from(&bump_bytes)];
    let signers = [Signer::from(&seeds)];
    let rent = Rent::get()?.try_minimum_balance(LEN)?;
    if vault.lamports() == 0 {
        CreateAccount { from: payer, to: vault, lamports: rent, space: LEN as u64, owner: program }.invoke_signed(&signers)?;
    } else {
        if vault.lamports() < rent { Transfer { from: payer, to: vault, lamports: rent - vault.lamports() }.invoke()?; }
        Allocate { account: vault, space: LEN as u64 }.invoke_signed(&signers)?;
        Assign { account: vault, owner: program }.invoke_signed(&signers)?;
    }
    let mut data = [0; LEN]; data[0] = ACCOUNT_VERSION; data[2] = bump;
    data[3..35].copy_from_slice(root); data[35..67].copy_from_slice(coordinator);
    write(vault, &data)
}
fn validate_op(program: &Address, vault: &AccountView, data: &[u8; LEN], op: &[u8; OP_LEN]) -> ProgramResult {
    if op[0] != 1 || u64::from_le_bytes(fixed(&op[1..9])?) == 0 { return Err(ProgramError::InvalidInstructionData); }
    let recipient = &op[9..41]; let next = &op[41..73]; let next_root = &op[73..105];
    if recipient == vault.address().as_array() || next == vault.address().as_array() || recipient == next || next_root == &data[3..35] || next_root == &[0;32] { return Err(ProgramError::InvalidArgument); }
    let (expected, _) = Address::derive_program_address(&[SEED, next_root, &data[35..67]], program).ok_or(ProgramError::InvalidSeeds)?;
    if expected.as_array() != next { return Err(ProgramError::InvalidSeeds); } Ok(())
}

pub fn process_instruction(program: &Address, accounts: &mut [AccountView], bytes: &[u8]) -> ProgramResult {
    let (&disc, payload) = bytes.split_first().ok_or(ProgramError::InvalidInstructionData)?;
    match disc {
        0 => { // Root is never exposed as a WOTS signature during creation.
            let [payer, coordinator, vault, sys] = accounts else { return Err(ProgramError::NotEnoughAccountKeys); };
            system(sys)?; signer(coordinator)?;
            create_vault(program, payer, vault, &fixed(payload)?, coordinator.address().as_array())
        },
        1 => {
            let [payer, vault, sys] = accounts else { return Err(ProgramError::NotEnoughAccountKeys); };
            system(sys)?; signer(payer)?;
            if state(program, vault)?[1] != AVAILABLE { return Err(ProgramError::InvalidAccountData); }
            let amount = u64::from_le_bytes(fixed(payload)?);
            if amount == 0 { return Err(ProgramError::InvalidArgument); }
            Transfer { from: payer, to: vault, lamports: amount }.invoke()
        },
        2 => { // Immutable first-writer commitment. Coordination cannot spend.
            let [coordinator, vault] = accounts else { return Err(ProgramError::NotEnoughAccountKeys); };
            signer(coordinator)?; let mut data = state(program, vault)?;
            if coordinator.address().as_array() != &data[35..67] { return Err(ProgramError::MissingRequiredSignature); }
            let op = fixed::<OP_LEN>(payload)?; validate_op(program, vault, &data, &op)?;
            match data[1] {
                AVAILABLE => { data[1] = COMMITTED; data[67..].copy_from_slice(&op); write(vault, &data) },
                COMMITTED if data[67..] == op => Ok(()),
                _ => Err(ProgramError::InvalidAccountData),
            }
        },
        3 => {
            let [payer, vault, recipient, next, sys] = accounts else { return Err(ProgramError::NotEnoughAccountKeys); };
            system(sys)?; signer(payer)?;
            if payload.len() != OP_LEN + SIGNATURE_LEN { return Err(ProgramError::InvalidInstructionData); }
            let op = fixed::<OP_LEN>(&payload[..OP_LEN])?;
            let mut data = state(program, vault)?;
            if data[1] != COMMITTED || data[67..] != op { return Err(ProgramError::InvalidAccountData); }
            validate_op(program, vault, &data, &op)?;
            if recipient.address().as_array() != &op[9..41] || next.address().as_array() != &op[41..73] { return Err(ProgramError::InvalidArgument); }
            let signature: &WinternitzSignature<22> = payload[OP_LEN..].try_into().map_err(|_| ProgramError::InvalidInstructionData)?;
            let root = WinternitzRoot::new(fixed(&data[3..35])?);
            // Full operation, old vault identity, coordinator, program and network
            // domain are signed. All remaining SOL has exactly one bound output.
            if !signature.verify(&[DOMAIN, NETWORK_DOMAIN, program.as_array(), vault.address().as_array(), &data[3..35], &data[35..67], &op], &root) { return Err(ProgramError::MissingRequiredSignature); }
            let rent = Rent::get()?.try_minimum_balance(LEN)?;
            let amount = u64::from_le_bytes(fixed(&op[1..9])?);
            let remainder = vault.lamports().checked_sub(rent).and_then(|n| n.checked_sub(amount)).ok_or(ProgramError::InsufficientFunds)?;
            // Consume before the only CPI (known System Program). Runtime rollback
            // preserves the commitment if payer funds or account creation fail.
            data[1] = CONSUMED; write(vault, &data)?;
            create_vault(program, payer, next, &fixed(&op[73..105])?, &fixed(&data[35..67])?)?;
            // Recipient may also pay the new account's rent. Read its balance
            // after the CPI so that rent is not accidentally restored.
            let recipient_balance = recipient.lamports().checked_add(amount).ok_or(ProgramError::ArithmeticOverflow)?;
            let next_balance = next.lamports().checked_add(remainder).ok_or(ProgramError::ArithmeticOverflow)?;
            vault.set_lamports(rent); recipient.set_lamports(recipient_balance); next.set_lamports(next_balance);
            Ok(())
        },
        _ => Err(ProgramError::InvalidInstructionData),
    }
}
