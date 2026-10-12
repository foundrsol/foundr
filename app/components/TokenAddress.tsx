'use client';
import { useEffect, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
export default function TokenAddress() {
  const [address, setAddress] = useState<string | null>(null), [status, setStatus] = useState('');
  const [ownerProvided, setOwnerProvided] = useState(false);
  useEffect(() => {
    let active = true;
    fetch('/token.json', { cache: 'no-store' }).then(r => { if (!r.ok) throw Error('Token configuration unavailable'); return r.json(); }).then(value => {
      if (active && value.symbol === '$SHELL' && value.network === 'mainnet-beta' && ['verified', 'owner-provided'].includes(value.status) && typeof value.address === 'string') {
        setAddress(new PublicKey(value.address).toBase58()); setOwnerProvided(value.status === 'owner-provided');
      }
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  async function copy() {
    if (!address) return;
    try { await navigator.clipboard.writeText(address); setStatus('Contract address copied'); }
    catch { setStatus('Copy unavailable. Select the address text to copy it.'); }
  }
  return <div className="token-contract-section">
    <div className="token-contract" aria-label="$SHELL contract address">
      <img src="/favicon.svg" width="26" height="26" alt=""/>
      <strong>$SHELL</strong>
      <span className={`token-ca ${address ? 'mono' : 'pending-ca'}`} data-testid="token-ca">{address ?? 'Contract address pending'}</span>
      <button className="ca-copy" type="button" aria-label="Copy SHELL contract address" title={address ? 'Copy the complete contract address' : 'Available when the project supplies its contract address'} disabled={!address} onClick={copy}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/></svg>
        <span>Copy CA</span>
      </button>
    </div>
    <span className="ca-status" role="status">{status || (address ? ownerProvided ? 'Project-supplied contract address' : 'Token address · separate from your vault program address' : 'The website is available before the token launches.')}</span>
  </div>;
}
