use arrayref::array_refs;
use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    program_error::ProgramError,
    sysvars::{rent::Rent, Sysvar},
    ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

pub struct OpenVault {
    hash: [u8; 32],
    bump: [u8; 1],
}

impl OpenVault {
    pub fn deserialize(bytes: &[u8]) -> Result<Self, ProgramError> {
        let data: [u8; 33] = bytes
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?;

        let (hash, bump) = array_refs![&data, 32, 1];
        Ok(Self {
            hash: *hash,
            bump: *bump,
        })
    }

    pub fn process(&self, accounts: &[AccountInfo]) -> ProgramResult {
        // Assert we have exactly 2 accounts
        let [payer, vault, _system_program] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        let lamports = Rent::get()?.minimum_balance(0);
        let seeds = [Seed::from(&self.hash), Seed::from(&self.bump)];
        let signers = [Signer::from(&seeds)];

        // Create our vault
        CreateAccount {
            from: payer,
            to: vault,
            lamports,
            space: 0,
            owner: &crate::ID,
        }
        .invoke_signed(&signers)
    }
}

