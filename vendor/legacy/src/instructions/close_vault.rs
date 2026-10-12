use arrayref::array_refs;
use pinocchio::{account_info::AccountInfo, program_error::ProgramError, ProgramResult};
use solana_winternitz::signature::WinternitzSignature;

pub struct CloseVault {
    signature: WinternitzSignature,
    bump: [u8; 1],
}

impl CloseVault {
    pub fn deserialize(bytes: &[u8]) -> Result<Self, ProgramError> {
        let data: [u8; core::mem::size_of::<WinternitzSignature>() + 1] = bytes
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?;

        let (signature_bytes, bump) = array_refs![&data, 896, 1];

        Ok(Self {
            signature: WinternitzSignature::from(*signature_bytes),
            bump: *bump,
        })
    }

    pub fn process(&self, accounts: &[AccountInfo]) -> ProgramResult {
        // Assert we have exactly 2 accounts
        let [vault, refund] = accounts else {
            return Err(ProgramError::NotEnoughAccountKeys);
        };

        // Recover our pubkey hash from the signature
        let hash = self.signature.recover_pubkey(refund.key()).merklize();

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

        // Close Vault and refund balance to Refund account
        *refund.try_borrow_mut_lamports()? += vault.lamports();
        vault.close()
    }
}

