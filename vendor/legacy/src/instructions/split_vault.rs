use arrayref::array_refs;
use pinocchio::{account_info::AccountInfo, program_error::ProgramError, ProgramResult};
use solana_winternitz::signature::WinternitzSignature;

pub struct SplitVault {
    signature: WinternitzSignature,
    amount: u64,
    bump: [u8; 1],
}

impl SplitVault {
    pub fn deserialize(bytes: &[u8]) -> Result<Self, ProgramError> {
        let data: [u8; 905] = bytes
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?;

        let (signature_bytes, amount_bytes, bump) = array_refs![&data, 896, 8, 1];

        Ok(Self {
            signature: WinternitzSignature::from(*signature_bytes),
            amount: u64::from_le_bytes(*amount_bytes),
            bump: *bump,
        })
    }

    pub fn process(&self, accounts: &[AccountInfo]) -> ProgramResult {
        // Assert we have exactly 2 accounts
        let [vault, split, refund] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        // Assemble our Split message
        let mut message = [0u8; 72];
        message[0..8].clone_from_slice(&self.amount.to_le_bytes());
        message[8..40].clone_from_slice(split.key());
        message[40..].clone_from_slice(refund.key());

        // Recover our pubkey hash from the signature
        let hash = self.signature.recover_pubkey(&message).merklize();

        // Fast PDA equivalence check
        if solana_nostd_sha256::hashv(&[
            hash.as_ref(),
            self.bump.as_ref(),
            crate::ID.as_ref(),
            b"ProgramDerivedAddress",
        ])
        .ne(vault.key())
        {
            return Err(ProgramError::MissingRequiredSignature);
        }

        // Close Vault, send split balance to Split account, refund remainder to Refund account
        *split.try_borrow_mut_lamports()? += self.amount;
        *refund.try_borrow_mut_lamports()? += vault.lamports().saturating_sub(self.amount);

        vault.close()
    }
}

