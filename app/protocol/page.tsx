'use client';
import { useEffect, useRef, useState } from 'react';
import { BN } from '@anchor-lang/core';
import { Buffer } from 'buffer';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import TokenAddress from '../components/TokenAddress';
import SiteNavigation from '../components/SiteNavigation';
import { ProtocolClient, PROTOCOL_ID, configAddress, pda, operatorAddress, subscriptionAddress, solscan, solscanAddress, type ProtocolSnapshot, type ProtocolDeployment } from '../../src/protocol/client.ts';
import { PublicWalletJournal, type PublicAction } from '../../src/protocol/wallet.ts';
import { formatUnits, parseUnits } from '../../src/protocol/fees.ts';
import type { Stage } from '../../src/core/engine.ts';
import type { WalletProvider } from '../../src/solana/chain.ts';
import { hex, random } from '../../src/core/bytes.ts';
const compact = (s: string) => `${s.slice(0, 6)}…${s.slice(-6)}`;
const date = (n: bigint) => new Date(Number(n) * 1000).toLocaleString();
const labels: Record<number, string> = { 1: 'Paid security operation', 2: 'Enterprise subscription', 3: 'Buyback + burn', 4: 'Treasury release' };
export default function Protocol() {
  const client = useRef<ProtocolClient | null>(null), wallet = useRef<WalletProvider | null>(null), journal = useRef<PublicWalletJournal | null>(null), running = useRef(false);
  const [snapshot, setSnapshot] = useState<ProtocolSnapshot | null>(null), [status, setStatus] = useState('Checking the devnet deployment…');
  const [asset, setAsset] = useState<'SOL' | 'SPL'>('SOL'), [walletKey, setWalletKey] = useState(''), [busy, setBusy] = useState(false), [stage, setStage] = useState<Stage | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [action, setAction] = useState<PublicAction | null>(null), [amount, setAmount] = useState(''), [showPreview, setShowPreview] = useState<'subscription' | 'register' | 'stake' | 'unstake' | null>(null);
  const [rent, setRent] = useState<bigint | null>(null), [fee, setFee] = useState<bigint | null>(null);
  async function refresh() {
    if (!client.current || running.current) return;
    running.current = true;
    try {
      const value = await client.current.snapshot();
      for (const receipt of value.receipts.slice(0, 10)) { try { receipt.signature = await client.current.receiptSignature(receipt.address); } catch {} }
      setSnapshot(value); setStatus(`Finalized devnet data · slot ${value.slot.toLocaleString()} · ${date(value.timestamp)}`);
      if (journal.current) setAction(await journal.current.reconcile());
    } catch (e) { setSnapshot(null); setStatus((e as Error).message); }
    finally { running.current = false; }
  }
  useEffect(() => {
    let active = true;
    fetch('/protocol-deployment.json', { cache: 'no-store' }).then(r => { if (!r.ok) throw Error('Protocol deployment manifest unavailable'); return r.json(); }).then((d: ProtocolDeployment) => { if (active) { client.current = new ProtocolClient(d); void refresh(); } }).catch(e => { if (active) setStatus(e.message); });
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  async function connect() {
    setError('');
    try {
      const provider = window.phantom?.solana ?? window.solana ?? window.solflare;
      if (!provider || !client.current) throw Error('Enable Phantom or Solflare in this browser. Never enter a wallet seed phrase.');
      const result = await provider.connect(); wallet.current = provider; setWalletKey(result.publicKey.toBase58()); journal.current = new PublicWalletJournal(client.current, provider); setAction(await journal.current.read());
    } catch (e) { setError((e as Error).message); }
  }
  async function preview(kind: 'subscription' | 'register' | 'stake' | 'unstake') {
    setError(''); setRent(null); setFee(null);
    try {
      if (!client.current || !wallet.current?.publicKey || !snapshot) throw Error('A verified protocol and connected wallet are required');
      setShowPreview(kind);
      const c = client.current, payer = wallet.current.publicKey, block = await c.connection.getLatestBlockhash('finalized');
      const size = kind === 'subscription' ? c.program.coder.accounts.size('receipt') : kind === 'register' ? c.program.coder.accounts.size('operator') : 0;
      setRent(size ? BigInt(await c.connection.getMinimumBalanceForRentExemption(size, 'finalized')) + (kind === 'register' ? BigInt(await c.connection.getMinimumBalanceForRentExemption(165, 'finalized')) : 0n) : 0n);
      const { Transaction, TransactionInstruction } = await import('@solana/web3.js');
      const tx = new Transaction({ feePayer: payer, ...block }).add(new TransactionInstruction({ programId: PROTOCOL_ID, keys: [{ pubkey: payer, isSigner: true, isWritable: true }], data: Buffer.alloc(0) }));
      const quote = await c.connection.getFeeForMessage(tx.compileMessage(), 'finalized'); if (quote.value === null) throw Error('Network fee unavailable'); setFee(BigInt(quote.value));
    } catch (e) { setError((e as Error).message); }
  }
  async function approve() {
    if (busy || !showPreview || !snapshot || !client.current || !wallet.current?.publicKey || !journal.current || rent === null) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const c = client.current, config = await c.validate(), payer = wallet.current.publicKey, kind = showPreview;
      if (config.revision !== snapshot.config.revision) throw Error('Configuration changed. Refresh and review the fee again.');
      let receipt: PublicKey, nonce: string, value: bigint, ix;
      if (kind === 'subscription') {
        const bytes = random(32); nonce = hex(bytes); value = config.fees.subscriptionPrice; receipt = subscriptionAddress(payer, bytes);
        ix = await c.instruction('paySubscription', [Array.from(bytes), new BN(value.toString()), new BN(config.revision.toString())], { payer, config: configAddress(), quoteMint: config.quoteMint, payerQuote: getAssociatedTokenAddressSync(config.quoteMint, payer), splBuyback: config.splBuyback, splTreasury: config.splTreasury, receipt, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId });
      } else {
        value = parseUnits(amount, snapshot.shellDecimals); if (value === 0n) throw Error('Enter a positive stake amount');
        const operator = operatorAddress(payer); receipt = operator;
        const state = snapshot.operators.find(o => o.owner.equals(payer)); nonce = state?.actionNonce.toString() ?? '0';
        const accounts = { owner: payer, config: configAddress(), shellMint: config.shellMint, operator, stakeVault: pda('stake-vault', operator.toBytes()), ownerShell: getAssociatedTokenAddressSync(config.shellMint, payer), tokenProgram: TOKEN_PROGRAM_ID };
        ix = await c.instruction(kind === 'register' ? 'registerOperator' : kind, kind === 'register' ? [new BN(value.toString())] : [new BN(value.toString()), new BN(nonce)], kind === 'register' ? { ...accounts, systemProgram: SystemProgram.programId } : accounts);
      }
      const result = await journal.current.approve({ kind, receipt: receipt.toBase58(), nonce, amount: value.toString(), revision: config.revision.toString() }, [ix], rent, setStage);
      setAction(result); setShowPreview(null); setNotice(result.state === 'confirmed' ? 'Action finalized on devnet.' : 'Action submitted. Reconcile before approving another.'); await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const s = snapshot, c = s?.config, native = asset === 'SOL', decimals = native ? 9 : s?.quoteDecimals ?? 6, symbol = native ? 'SOL' : 'QUOTE test token';
  const metric = (n?: bigint, d = decimals, unit = symbol) => n === undefined ? '—' : `${formatUnits(n, d)} ${unit}`;
  const owner = s?.operators.find(o => o.owner.toBase58() === walletKey);
  const settlement = s?.receipts.filter(r => r.kind === 3).slice(0, 10) ?? [];
  return <>
    <div className="devnet-banner"><span className="test-mark">◈</span> DEVNET — TEST FUNDS ONLY <span className="banner-detail">No real funds.</span></div>
    <header className="topbar"><a className="brand" href="/"><span className="brand-symbol"><img src="/favicon.svg" width="25" height="25" alt=""/></span>SHELL<span className="brand-version">experimental</span></a><SiteNavigation/><div className="wallet-connect"><button className="button secondary small" onClick={connect} disabled={busy}>{walletKey ? compact(walletKey) : 'Connect wallet'}</button></div></header>
    <main className="protocol-page">
      <section className="protocol-intro"><div><div className="eyebrow mint-text">SECURITY · REVENUE · ACCOUNTABILITY</div><h1>A stronger shell.<br/>An open record.</h1><p>Every paid service creates a receipt. Every completed burn has a transaction you can verify.</p><a className="button secondary small" href="/">Open your vault →</a></div><img src="/crab.svg" alt="An original hermit crab changing shells" width="220" height="200"/></section>
      <TokenAddress/>
      <div className={`protocol-verification ${s ? 'is-verified' : ''}`} data-testid="protocol-state"><span className={s ? 'mint-dot dot' : 'dot'}/><div><strong>{s ? 'Verified on-chain accounting' : 'Awaiting verified protocol deployment'}</strong><p>{status}</p></div><button className="icon-button" aria-label="Refresh protocol data" onClick={() => void refresh()} disabled={busy || running.current}>↻</button></div>
      {error && <div className="alert error" role="alert">{error}</div>}{notice && <div className="alert notice" role="status">{notice}</div>}
      <div className="protocol-section-heading"><div><h2>Protocol accounting</h2><p>Revenue and volume are separate. SOL and SPL amounts are never combined.</p></div><div className="asset-tabs" role="group" aria-label="Revenue asset"><button className={native ? 'selected' : ''} onClick={() => setAsset('SOL')}>SOL</button><button className={!native ? 'selected' : ''} onClick={() => setAsset('SPL')}>SPL quote</button></div></div>
      <section className="protocol-metrics" aria-label="On-chain metrics">
        {[
          ['Protected transaction volume', metric(c?.nativeVolume, 9, 'SOL'), 'SOL volume recorded by paid vault operations only.'],
          ['Cumulative fees collected', metric(native ? c?.nativeFees : c?.splFees), 'Actual protocol revenue; excludes deposits and network fees.'],
          ['Revenue · last 24 hours', metric(native ? s?.native24h : s?.spl24h), 'Finalized payment receipts within the snapshot window.'],
          ['Pending buyback allocation', metric(c ? native ? c.nativeAllocated - c.nativeSpent : c.splAllocated - c.splSpent : undefined), 'Collected allocation awaiting successful settlement.'],
          ['Buyback vault balance', metric(native ? s?.nativeBuybackBalance : s?.splBuybackBalance), 'Spendable chain balance, excluding SOL rent. Includes any donations.'],
          ['Treasury balance', metric(native ? s?.nativeTreasuryBalance : s?.splTreasuryBalance), 'Actual on-chain balance; treasury releases require two administrators.'],
          ['Total tokens bought back', metric(c ? c.nativeBought + c.splBought : undefined, s?.shellDecimals ?? 6, 'SHELL test tokens'), 'Purchased output across successful atomic settlements.'],
          ['Total tokens burned', metric(c?.burned, s?.shellDecimals ?? 6, 'SHELL test tokens'), 'Real SPL Token burn calls, with supply reductions.'],
        ].map(([label, value, detail]) => <article className="panel metric-card" key={label}><span className="eyebrow">{label}</span><strong className="metric-value" data-testid="protocol-metric">{value}</strong><p>{detail}</p></article>)}
      </section>
      {!s && <p className="accounting-empty">No live financial metrics are available. A dash means unverified or unavailable data, never a fabricated zero.</p>}
      <section className="protocol-two-column">
        <article className="panel revenue-model"><div className="eyebrow mint-text">WHERE THE FEES GO</div><h2>Security that pays for itself.</h2><p>Every paid SHELL security operation contributes to protocol revenue. The proposed starting split allocates 80% to buying back and burning $SHELL, and 20% to the protocol treasury.</p><div className="allocation-bar"><span style={{ width: `${c ? c.fees.buybackBps / 100 : 80}%` }}/></div><div className="allocation-labels"><strong>{c ? c.fees.buybackBps / 100 : 80}% buyback + burn</strong><span>{c ? (10000 - c.fees.buybackBps) / 100 : 20}% treasury</span></div><p className="fineprint">{c ? 'Current split read from the verified configuration.' : 'Proposed Devnet defaults; no active fee collection is claimed.'} No return or token-price outcome is guaranteed.</p><div className="protocol-limitation"><strong>Controlled test liquidity only</strong><p>This build’s settlement adapter uses explicitly labeled test pools. No production DEX route or real market liquidity is claimed. Mainnet settlement remains disabled until a token, liquidity route and reviewed deployment exist.</p></div></article>
        <article className="panel pricing-panel"><div className="eyebrow">{c ? `ON-CHAIN CONFIGURATION · REVISION ${c.revision}` : 'PROPOSED DEVNET PRICING'}</div><h2>Pay for a service. Keep control.</h2><div className="price-row"><span>Basic vault security</span><strong>Free</strong></div>{['Advanced operation receipt', 'Protected transfer receipt', 'Rotation receipt'].map((name, i) => <div className="price-row" key={name}><span>{name}</span><strong>{((c?.fees.ratesBps ?? [25,10,30])[i] / 100).toFixed(2)}%</strong></div>)}<div className="price-row"><span>Enterprise subscription · 30 days</span><strong>{metric(c?.fees.subscriptionPrice, s?.quoteDecimals ?? 6, 'QUOTE')}</strong></div><p className="fineprint">Users do not need $SHELL to use their vault. Connecting a wallet is free. Paid receipts are required to claim a premium service through an integration. Fees have absolute on-chain caps and public, delayed governance.</p><button className="button secondary wide" disabled={!s || !walletKey || busy} onClick={() => void preview('subscription')}>Review enterprise payment</button><p className="fineprint">The subscription is a payment receipt, not a hosted enterprise API. API access requires an operator integrating receipt verification.</p></article>
      </section>
      <section className="panel history-panel"><div className="panel-heading"><div><h2>Buyback & burn history</h2><p>Purchases and burns complete atomically in the same transaction.</p></div><span className="count-label">{s ? `${settlement.length} recent settlements` : 'No verified records'}</span></div><div className="table-wrap"><table><thead><tr><th>Time</th><th>Revenue spent</th><th>Tokens bought</th><th>Tokens burned</th><th>Verification</th></tr></thead><tbody>{settlement.map(r => <tr key={r.address}><td>{date(r.timestamp)}</td><td className="mono">{formatUnits(r.amount, r.asset.toBase58() === 'So11111111111111111111111111111111111111112' ? 9 : s!.quoteDecimals)} {r.asset.toBase58() === 'So11111111111111111111111111111111111111112' ? 'SOL' : 'QUOTE'}</td><td className="mono">{formatUnits(r.bought, s!.shellDecimals)}</td><td className="mono">{formatUnits(r.burned, s!.shellDecimals)}</td><td><a className="mint-text" href={r.signature ? solscan(r.signature) : solscanAddress(r.address)} target="_blank" rel="noreferrer">{r.signature ? 'Transaction ↗' : 'Receipt account ↗'}</a></td></tr>)}</tbody></table></div>{!settlement.length && <div className="empty-history"><strong>{s ? 'No completed settlements yet.' : 'Settlement records await deployment.'}</strong><p>Test results are documented separately and never presented as live revenue or market activity.</p></div>}</section>
      <section className="protocol-two-column">
        <article className="panel"><div className="eyebrow">SUPPLY TRANSPARENCY</div><h2>Supply with a stated method.</h2><div className="price-row"><span>Current mint supply</span><strong>{metric(s?.supply, s?.shellDecimals ?? 6, 'test tokens')}</strong></div><div className="price-row"><span>Circulating upper bound</span><strong>{metric(s?.circulatingUpperBound, s?.shellDecimals ?? 6, 'test tokens')}</strong></div><p className="fineprint">Estimate = current mint supply minus controlled-pool balances and operator escrow. It does not classify team holdings, external locks or dormant accounts. Devnet mint authorities can issue additional test tokens.</p>{c && <a className="source-link break" href={solscanAddress(c.shellMint.toBase58())} target="_blank" rel="noreferrer">Verify Devnet test mint ↗</a>}</article>
        <article className="panel"><div className="eyebrow mint-text">OPTIONAL ENTERPRISE OPERATORS</div><h2>Collateral with clear rules.</h2><p>Standard vault users need no stake. Operators hold their own escrow position; owner signatures authorize staking and withdrawal after the public lock period.</p><div className="price-row"><span>Eligibility minimum</span><strong>{metric(c?.fees.minimumStake, s?.shellDecimals ?? 6, 'test tokens')}</strong></div><div className="price-row"><span>Lock after each stake</span><strong>{c ? `${c.fees.operatorLockSeconds / 86400} days` : 'Awaiting configuration'}</strong></div><p className="fineprint">No discretionary slashing, rewards or yield are implemented.</p><label className="operator-input">Amount of SHELL test tokens<input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="100.000000"/></label><div className="operator-actions"><button className="button secondary" disabled={!s || !walletKey || !amount || busy} onClick={() => void preview(owner ? 'stake' : 'register')}>{owner ? 'Add stake' : 'Register & stake'}</button><button className="button secondary" disabled={!owner || !s || owner.unlockAt > s.timestamp || !amount || busy} onClick={() => void preview('unstake')}>Unstake</button></div></article>
      </section>
      <section className="panel history-panel"><div className="panel-heading"><h2>Operator status</h2><span className="count-label">{s ? `${s.operators.length} registered` : 'Unverified'}</span></div><div className="table-wrap"><table><thead><tr><th>Operator owner</th><th>Stake</th><th>Eligibility</th><th>Unlock time</th></tr></thead><tbody>{s?.operators.map(o => <tr key={o.address}><td><a className="mono mint-text" href={solscanAddress(o.address)} target="_blank" rel="noreferrer">{compact(o.owner.toBase58())} ↗</a></td><td className="mono">{formatUnits(o.staked, s.shellDecimals)}</td><td>{o.eligible ? 'Stake requirement met' : 'Below minimum'}</td><td>{date(o.unlockAt)}</td></tr>)}</tbody></table></div>{!s?.operators.length && <div className="empty-history"><p>{s ? 'No operators registered.' : 'Operator records require a verified deployment.'}</p></div>}</section>
      <details className="rpc-diagnostics"><summary>Deployment & authority details</summary><p>The reserved Anchor program is <span className="mono break">{PROTOCOL_ID.toBase58()}</span>. Data is read only through https://api.devnet.solana.com after full genesis-hash and bytecode validation.</p><p>Program upgrade authorities can replace spending rules. This prototype and its upstream verifier have no independently verified audit and are not trustless. Fee changes use two distinct administrators and a one-hour on-chain delay.</p>{c && <p className="break">Configuration: {configAddress().toBase58()} · Treasury recipient: {c.treasuryRecipient.toBase58()} · Administrators: {c.admins.map(a => a.toBase58()).join(', ')}</p>}</details>
      {action && <div className="public-action-state"><strong>{labels[action.kind === 'subscription' ? 2 : 0] ?? action.kind}: {action.state}</strong>{action.signature && <a href={solscan(action.signature)} target="_blank" rel="noreferrer">Verify transaction ↗</a>}{!['confirmed','failed','expired'].includes(action.state) && <button className="button secondary small" disabled={busy} onClick={async () => { try { setAction(await journal.current!.reconcile(true)); } catch (e) { setError((e as Error).message); } }}>Reconcile / retry identical</button>}</div>}
      <footer><span className="footer-brand">SHELL</span><span>Experimental protocol · Devnet test assets only</span><a href="/">Return to Mainnet vault →</a></footer>
    </main>
    {showPreview && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="preview-title"><button className="modal-close" aria-label="Close transaction preview" disabled={busy} onClick={() => setShowPreview(null)}>×</button><div className="eyebrow mint-text">DEVNET · EXPLICIT WALLET APPROVAL</div><h2 id="preview-title">Transaction preview</h2>{error && <div className="alert error" role="alert">{error}</div>}<div className="review-line"><span>Operation</span><strong>{showPreview}</strong></div><div className="review-line"><span>Amount</span><strong>{showPreview === 'subscription' ? metric(c?.fees.subscriptionPrice, s?.quoteDecimals ?? 6, 'QUOTE test tokens') : `${amount || '0'} SHELL test tokens`}</strong></div><div className="review-line"><span>Network fee estimate</span><span>{metric(fee ?? undefined, 9, 'SOL')}</span></div><div className="review-line"><span>Account rent</span><span>{metric(rent ?? undefined, 9, 'SOL')}</span></div><div className="review-line"><span>Total SOL cost</span><strong>{metric(fee !== null && rent !== null ? fee + rent : undefined, 9, 'SOL')}</strong></div><p className="fineprint">Your ordinary wallet signature approves the displayed token payment or stake and SOL network costs. It does not authorize any protected vault withdrawal. SPL tokens and SOL are shown separately. A failed transaction may still consume its network fee.</p>{stage && <div className="stage" role="status">{stage}</div>}<button className="button primary wide" disabled={busy || fee === null || rent === null || !s} onClick={() => void approve()}>{busy ? 'Processing…' : 'Review in wallet & authorize'}</button></section></div>}
  </>;
}
