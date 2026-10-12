'use client';
import { useEffect, useRef, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { Engine, LOCAL_TRANSACTION_LIMIT, type Identity, type Stage } from '../../src/core/engine.ts';
import { BrowserStore } from '../../src/core/store.ts';
import { parseSol, formatSol } from '../../src/core/amount.ts';
import { MAX_RECOVERY_PACKAGE_BYTES, type Envelope } from '../../src/core/recovery.ts';
import { SolanaChain, explorer, addressExplorer, type Deployment, type WalletProvider } from '../../src/solana/chain.ts';
import { fundingDeploymentVerified, type DevnetDiagnostics } from '../../src/solana/network.ts';
import TokenAddress from './TokenAddress';
import SiteNavigation from './SiteNavigation';
import { ProtocolChain } from '../../src/protocol/chain.ts';
import { PROTOCOL_ID, type ProtocolConfig, type ProtocolDeployment, type PaidChoice } from '../../src/protocol/client.ts';
import { protocolFee, type Service } from '../../src/protocol/fees.ts';

import type { Cluster } from '../../src/core/protocol.ts';

type Modal = 'create' | 'unlock' | 'deposit' | 'withdraw' | 'backup' | 'recover' | 'security' | null;
type Activity = { signature: string; kind: string; amount?: string; state: string };
declare global { interface Window { phantom?: { solana?: WalletProvider }; solana?: WalletProvider; solflare?: WalletProvider } }
const short = (s?: string) => s ? `${s.slice(0, 6)}…${s.slice(-6)}` : 'Not connected';
function Icon({ name }: { name: 'shell' | 'wallet' | 'lock' | 'copy' | 'external' | 'refresh' | 'download' }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">{name === 'shell' ? <><path d="M20 14c0 4-4 7-9 7-5 0-8-3-8-8S7 3 13 3c5 0 8 4 8 8 0 4-3 7-7 7-3 0-5-2-5-5s2-5 5-5c2 0 4 2 4 4s-1 3-3 3-3-1-3-3"/></> : name === 'wallet' ? <><rect x="3" y="6" width="18" height="15" rx="3"/><path d="M17 6V3L5 6m16 6h-6v5h6"/><path d="M17 14.5h.1"/></> : name === 'lock' ? <><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></> : name === 'copy' ? <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/></> : name === 'external' ? <><path d="M14 3h7v7m0-7-11 11M10 4H4v16h16v-6"/></> : name === 'refresh' ? <><path d="M20 7a9 9 0 1 0 1 9M20 3v5h-5"/></> : <><path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/></>}</svg>;
}
export default function VaultApp({ network }: { network: Cluster }) {
  const isMainnet = network === 'mainnet-beta';
  const profile = isMainnet ? 'mainnet-v2' : 'devnet-v1';
  const networkName = isMainnet ? 'Mainnet' : 'Devnet';
  const networkLower = isMainnet ? 'mainnet' : 'devnet';
  const [deployment, setDeployment] = useState<Deployment | null>(null);
  const [diagnostics, setDiagnostics] = useState<DevnetDiagnostics | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [hasLocal, setHasLocal] = useState(false);
  const [walletName, setWalletName] = useState('Phantom');
  const [walletAddress, setWalletAddress] = useState('');
  const [walletBalance, setWalletBalance] = useState<bigint | null>(null);
  const [vaultBalance, setVaultBalance] = useState<bigint | null>(null);
  const [uninitializedAccount, setUninitializedAccount] = useState<{ address: string; balance: bigint } | null>(null);
  const [activationCosts, setActivationCosts] = useState<{ fee: bigint; rentTopUp: bigint } | null>(null);
  const [rent, setRent] = useState<bigint | null>(null);
  const [feeQuote, setFeeQuote] = useState<bigint | null>(null);
  const [onChain, setOnChain] = useState(false);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState('');
  const [recoveryFile, setRecoveryFile] = useState<Envelope | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [service, setService] = useState<Service>(0), [premiumConfig, setPremiumConfig] = useState<ProtocolConfig | null>(null), [premiumStatus, setPremiumStatus] = useState('Premium receipts require a verified protocol deployment.');
  const [premiumRent, setPremiumRent] = useState<bigint | null>(null);
  const engine = useRef<Engine | null>(null), chain = useRef<SolanaChain | null>(null), store = useRef<BrowserStore | null>(null), busyRef = useRef(false);
  const refreshInFlight = useRef<Promise<void> | null>(null);
  const walletListeners = useRef<(() => void) | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const current = identity?.shells.find(s => s.root === identity.current);
  const uninitializedBalance = uninitializedAccount?.address === current?.address ? uninitializedAccount?.balance ?? null : null;
  const pending = current?.pending;
  const verified = !!identity && identity.securityRevision === identity.verifiedRevision;
  const deploymentReady = fundingDeploymentVerified(diagnostics);
  const ready = deploymentReady && !!walletAddress && verified && onChain && !identity?.blocked;
  const awaitingActivation = !!identity && !onChain && uninitializedBalance !== null && uninitializedBalance > 0n;
  const displayedBalance = awaitingActivation ? uninitializedBalance : vaultBalance;
  async function refreshState(force = false) {
    const c = chain.current; if (!c) return;
    if (force || c.wallet?.publicKey || c.deployment.verified) {
      // Missing deployments and RPC failures are reported through diagnostics.
      // Neither changes whether the extension successfully connected.
      try { await c.validate(); } catch { /* Funding remains gated. */ }
    }
    if (c.wallet?.publicKey) {
      try { setWalletBalance(c.diagnostics.rpcStatus === 'verified' ? await c.walletBalance() : null); } catch { setWalletBalance(null); }
    }
    if (engine.current && !busyRef.current) {
      let i: Identity;
      try { i = fundingDeploymentVerified(c.diagnostics) ? await engine.current.reconcile() : await engine.current.read(); setIdentity(i); } catch { return; }
      setActivity(i.attempts.map(a => ({ signature: a.signature, kind: a.kind === 'authorization' ? 'Public signature record' : a.kind === 'commit' ? 'Operation commitment' : a.kind === 'withdraw' ? 'Withdraw + rotate' : a.kind === 'create' ? 'Vault initialization' : 'Deposit', amount: a.kind === 'commit' ? undefined : a.amount, state: a.state })).reverse());
      if (c.diagnostics.rpcStatus === 'verified') try {
        const active = i.shells.find(s => s.root === i.current)!;
        const authorized = fundingDeploymentVerified(c.diagnostics);
        const v = authorized ? await c.vault(active.address) : null;
        const received = v ? null : await c.uninitializedBalance(active.address);
        setUninitializedAccount(received === null ? null : { address: active.address, balance: received }); setOnChain(!!v);
        setVaultBalance(v ? v.balance - v.rent : authorized ? 0n : null);
        setActivationCosts(null);
        try {
          const reserve = await c.rent(); setRent(reserve);
          if (authorized && !v && received !== null && c.wallet?.publicKey) {
            setActivationCosts({ fee: await c.fee('create'), rentTopUp: received >= reserve ? 0n : reserve - received });
          }
        } catch { setActivationCosts(null); /* A failed quote never overwrites a confirmed account balance. */ }
        try {
          const rows = (await Promise.all(i.shells.map(s => c.connection.getSignaturesForAddress(new PublicKey(s.address), { limit: 20 }, 'finalized')))).flat();
          setActivity(previous => { const known = new Set(previous.map(a => a.signature)); return [...previous, ...rows.filter(r => !known.has(r.signature)).map(r => ({ signature: r.signature, kind: 'Vault activity', state: r.err ? 'failed' : r.confirmationStatus === 'finalized' ? 'confirmed' : 'confirming' }))]; });
        } catch { /* Explorer history indexing can fail independently of balance reads. */ }
      } catch { setVaultBalance(null); setUninitializedAccount(null); setActivationCosts(null); setOnChain(false); }
      else { setVaultBalance(null); setUninitializedAccount(null); setActivationCosts(null); setOnChain(false); }
    }
  }
  function refresh(): Promise<void> {
    if (refreshInFlight.current) return refreshInFlight.current;
    if (busyRef.current) return Promise.resolve();
    const task = refreshState(); refreshInFlight.current = task;
    void task.finally(() => { if (refreshInFlight.current === task) refreshInFlight.current = null; }).catch(() => {});
    return task;
  }
  useEffect(() => {
    let active = true;
    store.current = new BrowserStore(profile); store.current.exists().then(value => { if (active) setHasLocal(value); }).catch(() => { if (active) setError('This browser cannot provide durable encrypted storage. Signing is disabled.'); });
    Promise.all([fetch(isMainnet ? '/mainnet-deployment.json' : '/deployment.json', { cache: 'no-store' }).then(r => { if (!r.ok) throw Error('Deployment manifest missing'); return r.json() as Promise<Deployment>; }), (isMainnet ? Promise.resolve(null) : fetch('/protocol-deployment.json', { cache: 'no-store' })).then(r => r?.ok ? r.json() as Promise<ProtocolDeployment> : null).catch(() => null)]).then(([d, protocol]) => {
      if (!active) return;
      if (d.cluster !== network || (d.authorizationProfile ?? 'devnet-v1') !== profile) throw Error('The deployment belongs to a different network. Signing is blocked.');
      setDeployment(d); const sink = (value: DevnetDiagnostics) => { if (active) setDiagnostics(value); };
      chain.current = isMainnet ? new SolanaChain(d, undefined, undefined, sink) : new ProtocolChain(d, protocol, undefined, sink);
      void chain.current.validate().catch(() => { /* Public diagnostics distinguish missing deployment from RPC mismatch. */ });
    }).catch(() => { if (active) setError('Deployment configuration is unavailable. Funding is disabled.'); });
    return () => { active = false; walletListeners.current?.(); };
  }, [network, profile, isMainnet]);
  useEffect(() => { const timer = setInterval(() => { void refresh(); }, 6000); return () => clearInterval(timer); }, [deployment, walletAddress]);
  useEffect(() => {
    let alive = true; setFeeQuote(null);
    const c = chain.current;
    if (c && deploymentReady && walletAddress && (modal === 'deposit' || modal === 'withdraw')) {
      void (async () => {
        await c.validate();
        const fee = modal === 'deposit' ? await c.fee('deposit') : await c.fee('withdraw') + (!pending || pending.phase === 'prepared' ? await c.fee('commit') : 0n) + (service > 0 || pending?.paid ? await c.fee('authorization') : 0n);
        if (alive) { setFeeQuote(fee); setRent(await c.rent()); }
        if (modal === 'withdraw' && c instanceof ProtocolChain && c.protocol) {
          try { const config = await c.protocol.validate(); const extraRent = await c.authorizationRent() + await c.receiptRent(); if (alive) { setPremiumConfig(config); setPremiumRent(extraRent); setPremiumStatus('Verified protocol deployment · fees paid by your connected wallet.'); } }
          catch (e) { if (alive) { setPremiumConfig(null); setPremiumRent(null); setPremiumStatus((e as Error).message); } }
        }
      })().catch(() => { if (alive) setFeeQuote(null); });
    } return () => { alive = false; };
  }, [modal, walletAddress, deploymentReady, pending?.phase, service]);
  useEffect(() => {
    if (!modal) return; closeButton.current?.focus();
    const previous = document.activeElement as HTMLElement;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) setModal(null);
      if (e.key === 'Tab') { const items = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] button:not(:disabled), [role="dialog"] input:not(:disabled), [role="dialog"] a[href]')); const first = items[0], last = items.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
    };
    document.addEventListener('keydown', key); return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [modal]);
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return; busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try { await refreshInFlight.current; await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Operation could not be completed. Reconcile before retrying.'); }
    finally { busyRef.current = false; try { await refresh(); } finally { setBusy(false); } }
  }
  function open(value: Modal) { setError(''); setNotice(''); setAmount(''); setService(0); setRecoveryFile(null); setPassword(''); setConfirmation(''); setDownloaded(false); setModal(value); }
  async function connect() {
    await run(async () => {
      const provider = walletName === 'Solflare' ? window.solflare : window.phantom?.solana ?? window.solana;
      if (!provider || !chain.current) throw Error(`Install or enable ${walletName} in this browser to connect. SHELL never asks for your wallet’s seed phrase.`);
      const result = await provider.connect(); const c = chain.current; c.wallet = provider;
      walletListeners.current?.();
      const address = result.publicKey.toBase58(); setWalletAddress(address); c.reportWallet(address, walletName);
      const changed = () => { const next = provider.publicKey?.toBase58() ?? ''; setWalletAddress(next); setWalletBalance(null); c.reportWallet(next || null, next ? walletName : null); };
      const disconnected = () => { setWalletAddress(''); setWalletBalance(null); c.reportWallet(null, null); };
      provider.on?.('accountChanged', changed); provider.on?.('disconnect', disconnected);
      walletListeners.current = () => { provider.off?.('accountChanged', changed); provider.off?.('disconnect', disconnected); };
      // Phantom's injected Solana provider has no reliable selected-network
      // property. Use only our explicit, genesis-verified RPC for transactions.
      try { await c.verifyRpc(); setWalletBalance(await c.walletBalance()); } catch { setWalletBalance(null); }
    });
  }
  async function startIdentity(recover = false) {
    await run(async () => {
      if (!chain.current || !store.current) throw Error('Application is still loading');
      if (!recover && password !== confirmation && modal === 'create') throw Error('Recovery passwords do not match');
      const e = new Engine(store.current, chain.current, password, setStage);
      const i = recover ? await e.recover(recoveryFile!) : modal === 'unlock' ? await e.read() : await e.create();
      engine.current = e; setIdentity(i); setHasLocal(true); setPassword(''); setConfirmation(''); setRecoveryFile(null);
      setModal(recover || modal === 'unlock' ? null : 'backup');
      setNotice(recover ? i.blocked ?? 'Recovery verified locally. Chain state was reconciled; no replacement keys were invented.' : 'Your vault is encrypted on this device. Save its recovery file next.');
    });
  }
  async function readFile(file?: File) {
    if (!file) return;
    try { if (file.size > MAX_RECOVERY_PACKAGE_BYTES) throw Error('Recovery file is too large'); const value = JSON.parse(await file.text()) as Envelope; if (value.format !== 'SHELL-RECOVERY-1') throw Error('Choose a SHELL encrypted recovery package'); setRecoveryFile(value); setError(''); }
    catch (e) { setRecoveryFile(null); setError((e as Error).message); }
  }
  async function backup() {
    await run(async () => {
      const envelope = await engine.current!.exportBackup(); const url = URL.createObjectURL(new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `SHELL-${networkLower}-recovery-${identity!.id.slice(0, 8)}-v${identity!.securityRevision}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setDownloaded(true); setNotice('Save this file somewhere private. Re-open the saved file below to verify it.');
    });
  }
  function lock() { engine.current = null; setIdentity(null); setActivity([]); setVaultBalance(null); setOnChain(false); setPassword(''); setModal(null); setNotice('Vault locked. Enter your SHELL recovery password to unlock it.'); }
  const pendingUnknown = identity?.attempts.some(a => ['outcome unknown', 'confirming', 'submitting'].includes(a.state));
  const stateLabel = identity?.blocked ? 'Signing blocked' : !identity ? hasLocal ? 'Locked on this device' : 'Not set up yet' : !verified ? 'Recovery file needs verification' : awaitingActivation ? 'SOL received · activation needed' : !onChain ? 'Saved on this device · not activated' : pending ? `Send ${pending.phase}` : 'Fresh keys · ready';
  const nextStep = identity?.blocked ? 'Signing is blocked. Check the saved operation before continuing.'
    : !identity ? hasLocal ? 'Enter your SHELL recovery password to open your saved vault.' : 'Start here: create your vault, then save its recovery file.'
    : !verified ? 'Save and verify your recovery file before adding SOL.'
    : pendingUnknown ? 'Check the pending transaction. Its amount and recipient cannot change.'
    : pending ? 'Continue your saved send. Its amount and recipient are already fixed.'
    : !deploymentReady ? 'Your recovery file is verified. Funding is paused while security checks are pending.'
    : !walletAddress ? 'Connect Phantom or Solflare to add SOL or pay transaction fees.'
    : !onChain && walletBalance === 0n ? awaitingActivation ? 'Your SOL is at this address. Your connected wallet needs SOL to pay the activation fee.' : 'Your connected wallet needs SOL for activation fees and rent.'
    : !onChain ? awaitingActivation ? 'Activate this vault to protect the SOL already at its address.' : 'Activate your backed-up vault on Solana before adding SOL.'
    : vaultBalance === 0n ? 'Add SOL from your connected wallet to start using your vault.'
    : 'Add SOL from your wallet, or send SOL to another address.';
  const rpcLabel = diagnostics?.rpcStatus === 'verified' ? `${networkName} RPC verified` : diagnostics?.rpcStatus === 'mismatch' ? 'RPC network mismatch' : diagnostics?.rpcStatus === 'unavailable' ? `${networkName} RPC unavailable` : `Checking ${networkLower} RPC`;
  let premiumFee: bigint | null = null;
  try { if (premiumConfig) premiumFee = protocolFee(BigInt(pending?.operation.amount ?? parseSol(amount || '0')), pending?.paid?.service ?? service, premiumConfig.fees); } catch {}
  const premiumNeeded = !!pending?.paid || service > 0;
  const feesNeedReview = !!pending?.paid && !!premiumConfig && (pending.paid.revision !== premiumConfig.revision.toString() || (premiumFee !== null && premiumFee > BigInt(pending.paid.maxFee)));
  const serviceNames = ['Basic vault · Free', 'Advanced operation receipt', 'Protected transfer receipt', 'Rotation receipt', 'Protected transfer + rotation receipt'];
  function paidChoice(): PaidChoice | undefined {
    const selected = pending?.paid?.service ?? service;
    if (selected === 0) return undefined;
    if (!premiumConfig || premiumFee === null) throw Error('A verified premium fee preview is required');
    return { program: PROTOCOL_ID.toBase58(), service: selected, maxFee: premiumFee.toString(), revision: premiumConfig.revision.toString() };
  }
  return <>
    {!isMainnet && <div className="devnet-banner">DEVNET — TEST FUNDS ONLY</div>}
    <header className="topbar">
      <a className="brand" href="/" aria-label="SHELL home"><span className="brand-symbol"><Icon name="shell"/></span>SHELL</a>
      <SiteNavigation current="wallet"/>
      <div className="wallet-connect">{walletAddress ? <button className="button secondary small" disabled={busy} title="Disconnect wallet" onClick={() => run(async () => { await chain.current?.wallet?.disconnect(); setWalletAddress(''); setWalletBalance(null); chain.current?.reportWallet(null, null); })}>{short(walletAddress)}</button> : <><select aria-label="Wallet provider" value={walletName} onChange={e => setWalletName(e.target.value)}><option>Phantom</option><option>Solflare</option></select><button className="button secondary small" disabled={busy || !deployment} onClick={connect}>Connect wallet</button></>}</div>
    </header>
    <main className="vault-page">
      <div className="intro"><h1>Your SOL. Your shell.</h1><p>A free vault. Fresh signing keys after every send.</p></div>
      {error && <div className="alert error" role="alert">{error}</div>}{notice && <div className="alert notice" role="status">{notice}</div>}
      {diagnostics?.rpcCause && <div className="alert error" role="alert" data-testid="rpc-error">{diagnostics.rpcCause}</div>}
      <section className="vault-surface" aria-label="Your SHELL vault">
        <section className="balance-grid" aria-label="Balances">
          <article className="balance-card vault-card">
            <img className="crab" src="/crab.svg" alt="A hermit crab carrying a mint spiral shell" width="56" height="56"/>
            <div className="card-label">{awaitingActivation ? 'SOL awaiting activation' : 'SHELL vault'}</div>
            <div className="balance">{displayedBalance === null ? '—' : formatSol(displayedBalance)}<span>SOL</span></div>
            <p className="balance-note">{awaitingActivation ? 'Confirmed at this address. Activate your vault to protect it.' : vaultBalance === null ? `Protected balance appears after a finalized ${networkLower} check.` : `Confirmed on ${networkLower}. Excludes the permanent vault-record rent.`}</p>
            <div className="vault-status"><span className={ready && !pending ? 'dot mint-dot' : 'dot'}/>{stateLabel}</div>
          </article>
          <article className="balance-card wallet-card">
            <div className="wallet-balance-row"><div className="card-label">Connected wallet</div><div className="balance">{walletBalance === null ? '—' : formatSol(walletBalance)}<span>SOL</span></div></div>
            <div className="card-bottom"><span>{walletAddress ? short(walletAddress) : 'Connect to fund your vault'}</span>{walletAddress && <button className="icon-button" title="Copy connected wallet address" onClick={() => { void navigator.clipboard.writeText(walletAddress); setNotice('Wallet address copied.'); }}><Icon name="copy"/></button>}</div>
            {walletAddress && <p className="wallet-network-note">Connected · wallet network not reported. Transactions use the explicitly configured {networkName} RPC.</p>}
          </article>
        </section>
        <section className="workspace-grid">
          <article className="vault-panel" id="get-started">
            <p className="next-step" aria-live="polite">{nextStep}</p>
            {!identity ? <button className="button primary wide setup-button" disabled={busy || !deployment} onClick={() => open(hasLocal ? 'unlock' : 'create')}>{hasLocal ? 'Unlock saved vault' : 'Create your vault'}</button> : !verified ? <button className="button primary wide setup-button" onClick={() => open('backup')}>Save recovery file</button> : !onChain ? <button className="button primary wide setup-button" disabled={!deploymentReady || !walletAddress || busy} onClick={() => run(async () => { await engine.current!.createOnChain(); })}>Activate vault</button> : null}
            <div className="primary-actions"><button className={`button ${ready && !pending ? 'primary' : 'secondary'}`} disabled={!ready || !!pending || busy} onClick={() => open('deposit')}>Add SOL</button><button className="button secondary" disabled={!ready || busy || (vaultBalance === 0n && !pending)} onClick={() => open('withdraw')}>{pending ? 'Continue saved send' : 'Send SOL'}</button></div>
            <div className="tools"><button disabled={!identity || busy} onClick={() => open('backup')}>Back up vault</button><button disabled={busy} onClick={() => open('recover')}>Restore vault</button>{identity && <button disabled={busy} onClick={lock}>Lock vault</button>}</div>
            <div className="address-box vault-address"><div className="address-heading"><span className="eyebrow">Vault address</span><button className="icon-button" disabled={busy} onClick={() => run(async () => { await refreshState(true); })} title="Refresh finalized balances"><Icon name="refresh"/></button></div><div className="full-address">{current?.address ?? 'Your address appears after creating a vault.'}</div>{current && <div className="address-actions"><button onClick={() => { void navigator.clipboard.writeText(current.address); setNotice('Current vault address copied. Use Add SOL so consumed vaults are rejected.'); }}><Icon name="copy"/>Copy</button><a href={addressExplorer(current.address, network)} target="_blank" rel="noreferrer"><Icon name="external"/>Explorer</a></div>}</div>
            {pendingUnknown && <div className="pending-box"><strong>Transaction confirmation is pending</strong><p>Keep the same operation. A timeout does not release your one-time key.</p><div><button disabled={busy} onClick={() => run(async () => { await engine.current!.reconcile(); })}>Check transaction status</button><button disabled={busy || !deploymentReady || !walletAddress} onClick={() => run(async () => { await engine.current!.retryIdentical(); })}>Retry same transaction</button></div></div>}
            {stage && <div className="stage" role="status"><span className={busy ? 'spinner' : 'dot'}/>{stage}</div>}
            <details className="cost-details"><summary>Network costs</summary>{activationCosts && <p className="rent-note" data-testid="activation-cost">Activation: {formatSol(activationCosts.fee)} SOL transaction fee + {formatSol(activationCosts.rentTopUp)} SOL rent top-up from your connected wallet. SOL already at the address covers the remaining rent.</p>}<p className="rent-note">{rent !== null ? `${formatSol(rent)} SOL rent per shell is reserved permanently to prevent key reuse. Fees come from your connected wallet.` : 'Network fees and new-shell rent are shown before you approve a funded operation.'}</p></details>
          </article>
        </section>
      </section>
      {!deploymentReady && deployment && <details className="deployment-note" data-testid="deployment-status"><summary><Icon name="lock"/><strong>{diagnostics?.deploymentStatus === 'missing' ? `SHELL program not deployed on ${networkLower}.` : isMainnet && deployment.verified && deployment.mainnetRelease?.status === 'review-required' ? 'Security review pending' : 'Vault funding unavailable'}</strong><span className="detail-hint">Details</span></summary><div className="deployment-detail"><p>{diagnostics?.deploymentCause ?? 'Program-account and source-matched deployment checks must pass before funding.'} Funding is disabled. You can create and back up your vault locally.</p><p>Creating a vault on this device never moves SOL.</p><button onClick={() => open('security')}>Security & launch requirements</button></div></details>}
      <section className="history-panel" aria-label="Transaction history">
        <div className="panel-heading"><h2>Activity</h2>{activity.length > 0 && <span className="count-label">{activity.length} transactions</span>}</div>
        {activity.length > 0 ? <><div className="table-wrap"><table><thead><tr><th>Operation</th><th>Amount</th><th>Status</th><th>Verification</th></tr></thead><tbody>{activity.map(a => <tr key={a.signature}><td>{a.kind}</td><td className="mono">{a.amount ? `${formatSol(BigInt(a.amount))} SOL` : '—'}</td><td><span className={`status-pill ${a.state === 'confirmed' ? 'confirmed' : a.state === 'failed' ? 'failed' : ''}`}>{a.state}</span></td><td><a href={explorer(a.signature, network)} target="_blank" rel="noreferrer" aria-label={`Verify ${a.signature} in Solana Explorer`}>{short(a.signature)}<Icon name="external"/></a></td></tr>)}</tbody></table></div><p className="history-retention">Last {LOCAL_TRANSACTION_LIMIT} local transactions. Unresolved attempts stay saved. Older activity is available in Explorer.</p></> : <div className="empty-history">No transactions yet.</div>}
      </section>
      <TokenAddress/>
      <div className="connection-area"><div className={`network-chip ${diagnostics?.rpcStatus === 'verified' ? 'rpc-verified' : ''}`} data-testid="rpc-status"><span/>{rpcLabel}</div>{diagnostics && <details className="rpc-diagnostics"><summary>Connection diagnostics</summary><dl>
        <dt>Authorization profile</dt><dd>{profile} · encrypted storage and recovery are separate by network</dd><dt>Selected RPC provider</dt><dd data-testid="rpc-endpoint">{diagnostics.rpcEndpoint}</dd>
        <dt>Browser RPC request URL</dt><dd data-testid="rpc-transport">{diagnostics.rpcTransportEndpoint}</dd>
        {isMainnet && <><dt>Finalized lifecycle history</dt><dd>https://api.mainnet-beta.solana.com · read-only owner receipts via /api/mainnet-history</dd></>}<dt>RPC genesis hash</dt><dd data-testid="rpc-genesis">{diagnostics.rpcGenesis ?? 'Not received'}</dd>
        <dt>RPC validation</dt><dd>{diagnostics.rpcStatus}{diagnostics.rpcCause ? ` · ${diagnostics.rpcCause}` : ''}</dd>
        <dt>Connected wallet public key</dt><dd data-testid="wallet-public-key">{diagnostics.walletPublicKey ?? 'Not connected'}</dd>
        <dt>Wallet active network</dt><dd>{diagnostics.walletNetwork}</dd>
        <dt>SHELL program ID</dt><dd>{diagnostics.programId}</dd>
        <dt>Deployment validation</dt><dd data-testid="deployment-verification">{diagnostics.deploymentStatus} · manifest attestation: {diagnostics.manifestVerified ? 'present' : 'absent'}{diagnostics.deploymentCause ? ` · ${diagnostics.deploymentCause}` : ''}</dd>
      </dl></details>}</div>
      <footer><span>Experimental quantum-resistant vault authorization.</span><div><button onClick={() => open('security')}>Security & limitations</button></div></footer>
    </main>
    {modal && <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy) setModal(null); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button ref={closeButton} className="modal-close" aria-label="Close dialog" disabled={busy} onClick={() => setModal(null)}>×</button><div className="eyebrow mint-text">SHELL · {isMainnet ? 'MAINNET' : 'DEVNET ONLY'}</div><h2 id="modal-title">{({ create: 'Create your vault', unlock: 'Unlock your vault', deposit: 'Add SOL to your vault', withdraw: 'Send SOL from your vault', backup: 'Save your recovery file', recover: 'Restore your vault', security: 'What protects your shell' } as const)[modal]}</h2>
      {error && <div className="alert error" role="alert">{error}</div>}{notice && <div className="alert notice" role="status">{notice}</div>}
      {(modal === 'create' || modal === 'unlock' || modal === 'recover') && <><p>{modal === 'create' ? 'Choose a new SHELL password to encrypt this vault’s keys and recovery file on your device.' : 'Enter the SHELL recovery password you chose for this vault.'} Never enter your Phantom or Solflare seed phrase here.</p>{modal === 'recover' && <label>Encrypted SHELL package<input type="file" accept=".json,application/json" onChange={e => { void readFile(e.target.files?.[0]); }}/></label>}<label>{modal === 'create' ? 'Choose a recovery password (12+ characters)' : 'Recovery password'}<input type="password" autoComplete={modal === 'create' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)}/></label>{modal === 'create' && <label>Confirm recovery password<input type="password" autoComplete="new-password" value={confirmation} onChange={e => setConfirmation(e.target.value)}/></label>}<div className="explanation"><Icon name="lock"/><p>Keys are generated and encrypted on this device. Keep the password separately from the encrypted package. Losing either can make funds inaccessible.</p></div><button className="button primary wide" disabled={busy || password.length < 12 || (modal === 'recover' && !recoveryFile)} onClick={() => startIdentity(modal === 'recover')}>{busy ? 'Working locally…' : modal === 'create' ? 'Create vault' : modal === 'unlock' ? 'Unlock vault' : 'Restore from file'}</button>{modal === 'recover' && <p className="fineprint">Recovery reconciles permanent on-chain commitments. A stale package missing the next keys is blocked. Existing local identities are never overwritten.</p>}</>}
      {modal === 'backup' && <><p>This {networkName} package cannot be used on the other network. The encrypted package contains your SHELL vault keys, coordination key, current operation, signing state, and any next-shell keys. It requires the recovery password you chose.</p><div className="backup-progress"><span className="number-circle">1</span><div><strong>Export the current encrypted package</strong><p>Revision {identity?.securityRevision}. Refresh after preparing each withdrawal, before committing it.</p></div></div><button className="button secondary wide" disabled={!identity || busy} onClick={backup}><Icon name="download"/>Download recovery file</button><div className="backup-progress"><span className="number-circle">2</span><div><strong>Re-open and decrypt the saved file</strong><p>Verification checks the current keys and intended operation.</p></div></div><label>Choose your saved recovery file<input type="file" accept=".json,application/json" onChange={e => { void readFile(e.target.files?.[0]); }}/></label><label>Recovery password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}/></label><button className="button primary wide" disabled={!identity || !recoveryFile || password.length < 12 || busy} onClick={() => run(async () => { await engine.current!.verifyBackup(recoveryFile!, password); setPassword(''); setRecoveryFile(null); setNotice('Recovery package verified. Keep this revision safe.'); setModal(pending ? 'withdraw' : null); })}>Verify recovery file</button><p className="fineprint">A seed alone is insufficient. The package includes operation state and independently generated keys. No file or password is uploaded.</p></>}
      {modal === 'deposit' && <><p className="fineprint">Experimental vault authorization. Independent security review pending.</p><p>Your wallet signature authorizes this deposit and its transaction fee. It does not authorize withdrawals from your vault.</p><label>Amount in SOL<input inputMode="decimal" placeholder="0.100000000" value={amount} onChange={e => setAmount(e.target.value)}/></label><div className="review-line"><span>To your current shell</span><span className="mono">{short(current?.address)}</span></div><div className="review-line"><span>Connected wallet</span><span>{walletBalance === null ? 'Unknown' : `${formatSol(walletBalance)} SOL`}</span></div><div className="review-line"><span>Estimated network fee, paid by wallet</span><span>{feeQuote === null ? 'Quoted before signing' : `${formatSol(feeQuote)} SOL`}</span></div><button className="button primary wide" disabled={!ready || busy || !amount} onClick={() => run(async () => { const result = await engine.current!.deposit(parseSol(amount)); setNotice(result.state === 'confirmed' ? `Deposit finalized on ${networkLower}.` : 'Deposit is pending. It is protected only after confirmation.'); setModal(null); })}>Approve deposit in wallet</button><p className="fineprint">The app checks the {networkLower} genesis hash, deployment bytecode, fee quote, and balance before submission. Protected balance uses finalized account state.</p></>}
      {modal === 'withdraw' && <>{!pending ? <><p>Your one-time SHELL signature will bind the amount, recipient, current vault, and next shell. Your connected wallet pays fees and new-shell rent.</p>{!isMainnet && <><label>Security service<select className="service-select" value={service} onChange={e => setService(Number(e.target.value) as Service)}><option value="0">Basic vault · Free</option>{[1,2,3,4].map(n => <option key={n} value={n} disabled={!premiumConfig}>{serviceNames[n]}</option>)}</select></label><p className="fineprint">{premiumStatus} Basic vault security includes one-time authorization and rotation. Premium operations add a verifiable paid service receipt for integrations.</p></>}<label>Amount in SOL<div className="input-action"><input inputMode="decimal" placeholder="0.050000000" value={amount} onChange={e => setAmount(e.target.value)}/><button disabled={vaultBalance === null} onClick={() => setAmount(formatSol(vaultBalance ?? 0n))}>Full balance</button></div></label><label>Recipient’s Solana address<input className="mono" placeholder="Enter the full recipient address" value={destination} onChange={e => setDestination(e.target.value)} autoComplete="off" spellCheck={false}/></label><div className="review-line"><span>Available, excluding old rent</span><span>{vaultBalance === null ? 'Unknown' : `${formatSol(vaultBalance)} SOL`}</span></div><div className="review-line"><span>New-shell rent, paid by wallet</span><span>{rent === null ? 'Quoted before signing' : `${formatSol(rent)} SOL`}</span></div><div className="review-line"><span>Estimated commit + withdrawal fees</span><span>{feeQuote === null ? 'Quoted before signing' : `${formatSol(feeQuote)} SOL`}</span></div><div className="review-line"><span>Protocol fee, paid by wallet</span><span>{service === 0 ? 'Free' : premiumFee === null ? 'Unavailable' : `${formatSol(premiumFee)} SOL`}</span></div>{premiumNeeded && <div className="review-line"><span>Public signature + receipt rent</span><span>{premiumRent === null ? 'Unavailable' : `${formatSol(premiumRent)} SOL`}</span></div>}<div className="review-line"><span>Total wallet cost, fees + rent</span><strong>{feeQuote !== null && rent !== null && (!premiumNeeded || (premiumRent !== null && premiumFee !== null)) ? `${formatSol(feeQuote + rent + (premiumNeeded ? premiumRent! + premiumFee! : 0n))} SOL` : 'Quoted before signing'}</strong></div><p className="fineprint">Required approvals: coordination commitment, then {premiumNeeded ? 'public signature record and paid withdrawal' : 'withdrawal'}. Your separate one-time signature authorizes spending. {!isMainnet && <>Paid operations allocate {premiumConfig ? premiumConfig.fees.buybackBps / 100 : 80}% of fees toward buyback and burn. Buybacks require a configured token and real liquidity.</>}</p><button className="button primary wide" disabled={!ready || busy || !amount || !destination} onClick={() => run(async () => { await engine.current!.prepareWithdrawal(parseSol(amount), destination, paidChoice()); setIdentity(await engine.current!.read()); setDownloaded(false); setModal('backup'); })}>Prepare send & save backup</button></> : <><div className="review-line"><span>Withdraw</span><strong>{formatSol(BigInt(pending.operation.amount))} SOL</strong></div><label>Recipient<div className="address-box mono">{pending.operation.destination}</div></label><label>Every remaining lamport moves to<div className="address-box mono">{pending.operation.nextAddress}</div></label>{pending.paid && <><div className="review-line"><span>Paid service</span><span>{serviceNames[pending.paid.service]}</span></div><div className="review-line"><span>Approved maximum protocol fee</span><span>{formatSol(BigInt(pending.paid.maxFee))} SOL</span></div><p className="fineprint">Public signature and receipt accounts retain rent permanently to prevent replay. Connecting a wallet never charges a protocol fee.</p>{feesNeedReview && <button className="button secondary wide" disabled={busy || !premiumConfig} onClick={() => run(async () => { await engine.current!.reviewPaidOperation(paidChoice()!); setIdentity(await engine.current!.read()); setModal('backup'); })}>Review updated fee & refresh backup</button>}</>}<div className="review-line"><span>Operation state</span><span className="status-pill">{pending.phase}</span></div><p>The amount and both destinations are now fixed locally. The on-chain commitment is permanent. A failed transaction does not allow a different message with this key.</p>{!verified ? <button className="button primary wide" onClick={() => open('backup')}>Save & verify updated recovery file</button> : pending.phase === 'prepared' ? <button className="button primary wide" disabled={busy || !walletAddress || !deploymentReady} onClick={() => run(async () => { await engine.current!.commitWithdrawal(); setNotice('Commitment submitted. Signing requires finalized on-chain confirmation.'); })}>Confirm send details on {networkLower}</button> : <button className="button primary wide" disabled={busy || !walletAddress || !deploymentReady || !!identity?.blocked || feesNeedReview || (!!pending.paid && !premiumConfig)} onClick={() => run(async () => { const result = await engine.current!.executeWithdrawal(); if (result.kind === 'authorization') { setNotice('Public signature record submitted. Reconcile its confirmation, then resume the identical withdrawal.'); } else { setModal(null); setNotice(result.state === 'confirmed' ? `Withdrawal and rotation finalized on ${networkLower}.` : 'Withdrawal submitted. The fresh shell appears once the rotation is finalized.'); } })}>Send SOL & change keys</button>}<p className="fineprint">Wallet signatures authorize coordination and fees. The separate hash-based signature authorizes spending. Retries preserve the same one-time operation.</p></>}{stage && <div className="stage" role="status">{busy && <span className="spinner"/>}{stage}</div>}</>}
      {modal === 'security' && <><p>Funds are controlled by SHELL’s on-chain program. Withdrawals require a Winternitz one-time signature; a Phantom or Solflare signature alone cannot spend vault funds.</p><ul className="security-list"><li><strong>Fresh keys for every spend.</strong> SHELL uses the pinned Winterwallet verifier with its existing parameters, plus a SOL-only operation format.</li><li><strong>Permanent operation commitments.</strong> A locally held coordination key freezes one operation on-chain before signing. It can block an operation if compromised, but cannot spend SOL.</li><li><strong>Permanent rent reserve.</strong> Old shells stay as consumed records. There is no rent-refund or administrator withdrawal route.</li><li><strong>Browser limitations.</strong> Malicious extensions, an infected device, changed application code, or unlocked memory can expose keys. Browser storage can be cleared. Use strong recovery passwords.</li><li><strong>Program upgrade authority.</strong> {isMainnet ? 'Mainnet deployments must be immutable, with no upgrade authority. Public funding requires exact-build release authorization and finalized lifecycle verification. This release is experimental; independent security review is pending. Application code, device security, RPC integrity and Solana remain dependencies.' : deployment?.upgradeAuthority ? <><span className="mono break">{deployment.upgradeAuthority}</span> is the dedicated development authority. It can change spending rules after deployment. This prototype is not trustless.</> : 'The pinned manifest must disclose the deployed upgrade authority before funding.'}</li><li><strong>Experimental vault authorization.</strong> Independent security review is pending for this adaptation and the pinned upstream version. It does not protect the whole Solana network against quantum attacks.</li></ul><div className="address-box"><div className="eyebrow">PROGRAM ID · {diagnostics?.deploymentStatus === 'verified' ? `VERIFIED ${networkName.toUpperCase()} DEPLOYMENT` : diagnostics?.deploymentStatus === 'missing' ? 'NOT DEPLOYED' : 'UNVERIFIED'}</div><p className="mono break">{deployment?.programId ?? 'Loading'}</p><div className="eyebrow">WINTERWALLET SOURCE COMMIT</div><p className="mono break">672fc6789b1532ee680f24842d235e0be8737b61</p></div><a className="source-link" href="https://github.com/blueshift-gg/winterwallet/tree/672fc6789b1532ee680f24842d235e0be8737b61" target="_blank" rel="noreferrer">Inspect the upstream source<Icon name="external"/></a></>}
    </section></div>}
  </>;
}
