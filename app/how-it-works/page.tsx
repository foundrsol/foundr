import type { Metadata } from 'next';
import SiteNavigation from '../components/SiteNavigation';

export const metadata: Metadata = { title: 'How it Works · SHELL', description: 'An on-chain SOL vault protected by hash-based, one-time signatures. A fresh shell and signing key after every spend.' };

export default function HowItWorks() {
  return <>
    <header className="topbar">
      <a className="brand" href="/" aria-label="SHELL home"><span className="brand-symbol"><img src="/favicon.svg" width="26" height="26" alt=""/></span>SHELL</a>
      <SiteNavigation current="guide"/>
      <div className="wallet-connect"><a className="button secondary small" href="/#get-started">Get started</a></div>
    </header>
    <main className="vault-page guide-page">
      <div className="intro"><img className="guide-crab" src="/crab.svg" alt="A hermit crab changing shells" width="88" height="88"/><h1>A fresh shell for your SOL.</h1><p>Your SOL in its own vault. A new key after every spend.</p></div>
      <ol className="guide-steps">
        <li><span className="number-circle" aria-hidden="true">1</span><div><h2>Your SOL lives in its own vault</h2><p>SHELL stores your SOL in an on-chain vault protected by hash-based, one-time signatures called <strong>Winternitz signatures</strong>. Your Phantom or Solflare signature alone can’t move the funds.</p></div></li>
        <li><span className="number-circle" aria-hidden="true">2</span><div><h2>Every spend changes the shell</h2><p>When you send SOL, the remaining balance moves into a fresh vault with a new signing key. The old shell is permanently consumed. Its key can’t authorize another spend.</p></div></li>
        <li><span className="number-circle" aria-hidden="true">3</span><div><h2>Built for quantum resistance</h2><p>These signatures rely on cryptographic hashes rather than the elliptic-curve mathematics that sufficiently powerful quantum computers could break. <strong>Quantum-resistant</strong> describes this experimental signature layer. Your device, recovery secrets and the Solana network still matter.</p></div></li>
      </ol>
      <div className="guide-start"><a className="button primary" href="/#get-started">Set up your vault</a><p>Create your vault, verify its recovery file, then connect your wallet to add SOL.</p></div>
      <details className="guide-details" id="getting-started"><summary>How do I get started?</summary><div>
        <p><strong>Create your vault.</strong> Set a SHELL recovery password. Your keys are created and encrypted on this device. Creating your local identity doesn’t move any SOL.</p>
        <p><strong>Save and verify your recovery file.</strong> Download the encrypted file, then reopen it in SHELL to verify it. You need the file and your password to restore your vault. SHELL never asks for your Phantom or Solflare seed phrase.</p>
        <p><strong>Connect your wallet and activate your vault.</strong> Once security checks pass, activate it on-chain. Choose <strong>Add SOL</strong> to move funds into the vault, or <strong>Send SOL</strong> to pay your chosen address. Before each send, save and verify an updated recovery file. Keep the latest version.</p>
      </div></details>
      <details className="guide-details" id="security-basics"><summary>What protects your vault?</summary><div>
        <p><strong>Two kinds of approval.</strong> Your connected wallet approves deposits, transaction fees and operation coordination. A separate, hash-based one-time signature authorizes spending from your SHELL vault.</p>
        <p><strong>One send per key.</strong> SHELL saves the amount and every destination before signing. Retries keep the same operation. If confirmation is uncertain, check its status before continuing.</p>
        <p><strong>Keep the latest recovery file.</strong> It contains encrypted vault keys and signing state. A password or basic seed alone cannot restore your vault safely. An old file may lack the keys needed after a send.</p>
        <p><strong>Costs are shown before approval.</strong> Your connected wallet pays Solana transaction fees and permanent vault-record rent. Old vault records remain on-chain to prevent key reuse.</p>
        <p><strong>Experimental quantum-resistant vault authorization.</strong> SHELL is browser-based software. Device security, recovery secrets, application and program correctness, RPC integrity and the underlying Solana network remain dependencies. The Mainnet vault program is immutable; independent security review is pending for this adaptation.</p>
      </div></details>
      <footer><span>Experimental quantum-resistant vault authorization.</span><div><a href="/">Return to wallet</a></div></footer>
    </main>
  </>;
}
