# Solana Winternitz Vault

The **Solana Winternitz Vault** is a **quantum-resistant lamports vault** that leverages **Winternitz One-Time Signatures** (WOTS) for security. The vault implements a truncated Keccak256 hash, offering **224-bits of preimage resistance**, which remains robust against quantum threats, including Grover's algorithm.

## Features

- **Quantum-Resistance**: Implements WOTS for cryptographic resilience against quantum computing attacks.
- **Efficient Hashing**: Uses a 224-bit truncated Keccak256 hash to conform to Solana's compute/instruction limits.

## Instructions Overview

The program provides three main instructions:

1. **Open Vault**
2. **Split Vault**
3. **Close Vault**

### 1. Open Vault

Initialize a new vault by:

- Generating a new **Winternitz keypair**.
- Computing the Keccak256 merkle root of the public key.
- Using the merkle root as the seed of a **Program-Derived Address (PDA)**.

#### Notes:
- **Hash Truncation**: Due to Solana's instruction data limits, hashes are truncated to 224 bits, however the merkle root of the public key used in PDA generation utilises the full 256-bits as there are no significant data limitations when opening a vault from an account hash.

### 2. Split Vault

This instruction allows splitting the balance of a vault across two accounts:

- A **split account** receives a specified amount of lamports.
- A **refund account** receives the remainder of the lamports.

This enables you to split the funds from a vault into two accounts. The primary purpose of this is to enable you to open two new vaults and transfer the contents of an existing vault into them with an unbroken chain of quantum-resistant cryptography.

#### Steps:
1. The user generates a Winternitz signature over a message containing the `amount` of lamports to transfer, along with the public key of the `split` account and the `refund` account.
2. The signature is used to verify ownership of the `vault` and prevent malleability in the case of a transaction replay attack.
3. The Winternitz public key is recovered from the signature, hashed and efficiently validated against the PDA seeds.
4. The lamports `amount` is distributed to the `split` account.
5. The remaining balance, if any, is refunded to the `refund` account and the `vault` is closed.

### 3. Close Vault

This instruction closes a vault and transfers all remaining lamports to a specified account.

#### Steps:
1. The user generates a Winternitz signature over a message containing the public key of the `refund` account.
2. The signature is used to verify ownership of the `vault` and prevent malleability in the case of a transaction replay attack.
3. The PDA and signature are validated.
4. The vault is closed, and its balance is refunded to the designated account.

## Testing

The program includes a comprehensive suite of tests to validate functionality:

1. **Open Vault**: Ensures the vault is created correctly with the appropriate PDA and initial lamport balance.
2. **Split Vault**: Verifies that funds are correctly split and authenticity is preserved.
3. **Close Vault**: Confirms that the vault closes securely and refunds the remaining balance.

## Security Considerations

- **Quantum Security**: The scheme ensures at least \(112\)-bit quantum security for collision resistance and \(224\)-bit for preimage resistance for hashes, along with 128-bit collision resistance and 256-bit preimage resistance for the public key merkle root. While the original Winternitz scheme uses untruncated Sha256 hashes, as Keccak is significantly more resistant to length-extension attacks, in a truncated scenario, it is by far the superior choice.
- **Reuse**: Winternitz signatures are for single-use only. Each time you sign a message, you reveal ~50% of your private key, lowering your own security guarantees. That is why we close and open new vaults with each spend. Please be careful if you are modifying this contract to retain this property.
- **Limitations**: This program is carefully optimized to operate within Solana's compute unit and instruction size constraints.
- **Update Authority**: While PDAs themselves should be quantum resistant, if the update authority of a program deploying this contract is a keypair, your funds are still at risk. Luckily, it's also possible to use Winternitz signatures to protect a program's update authority ;)

## Disclaimer

Use this program at your own risk. I am a pretty good dev larping as a cryptographer. I'm pretty sure this is going to outperform your regular Ed25519 keypair in the case that a nation state decides to attack your wallet. 

## Contributing

Contributions are welcome! Please open issues or submit pull requests to improve functionality or documentation.

