import { activationPlatformFee, PLATFORM_FEE_RECIPIENT } from '../../src/core/platform-fee.ts';
// Real browser cryptography and actual local SBF execution behind an explicit
// test RPC fixture. This is NOT a Devnet deployment or the real Phantom extension.
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Keypair, PublicKey, Message, Transaction, SystemProgram, Connection } from '@solana/web3.js';
import { address, lamports } from '@solana/kit';
import { runtime, info, LOADER } from '../runtime.ts';
import { VAULT_ID } from '../../src/protocol/client.ts';
import { authorizationContext, DEVNET_GENESIS } from '../../src/core/protocol.ts';
import { SolanaChain, type Deployment, type MainnetSmoke } from '../../src/solana/chain.ts';
import { Engine } from '../../src/core/engine.ts';
import { MemoryStore } from '../support.ts';
import { rpcForProfile } from '../../src/solana/network.ts';
import { EXPERIMENTAL_DISCLOSURE } from '../../src/solana/release.ts';
import { formatSol } from '../../src/core/amount.ts';
const PASSWORD = 'local-svm-browser-recovery-123';
for (const profile of ['devnet-v1', 'mainnet-v2'] as const) test(`browser + compiled SBF ${profile}: backup, deposit, partial/full rotation and clean-browser recovery`, async ({ page, browser }) => {
  test.setTimeout(120_000);
  const context = authorizationContext(profile), isMainnet = profile === 'mainnet-v2', routePath = isMainnet ? '/' : '/devnet', networkLabel = isMainnet ? 'mainnet' : 'devnet';
  const r = await runtime(), payer = r.admins[0], recipient = Keypair.generate().publicKey;
  const bytes = await readFile(isMainnet ? 'program/target/deploy/mainnet/shell_vault.so' : 'program/target/deploy/shell_vault.so'), programData = PublicKey.findProgramAddressSync([VAULT_ID.toBuffer()], LOADER)[0];
  if (isMainnet) r.svm.addProgram(address(VAULT_ID.toBase58()), new Uint8Array(bytes));
  r.connection.getGenesisHash = async () => context.genesis;
  const data = Buffer.alloc(45 + bytes.length); data.writeUInt32LE(3); data.writeBigUInt64LE(1n,4); data[12] = 0; bytes.copy(data,45);
  const program = Buffer.alloc(36); program.writeUInt32LE(2); programData.toBuffer().copy(program,4);
  r.svm.setAccount({ address: address(programData.toBase58()), executable: false, lamports: lamports(r.svm.minimumBalanceForRentExemption(BigInt(data.length))), programAddress: address(LOADER.toBase58()), data });
  r.svm.setAccount({ address: address(VAULT_ID.toBase58()), executable: true, lamports: lamports(r.svm.minimumBalanceForRentExemption(36n)), programAddress: address(LOADER.toBase58()), data: program });
  const manifest: Deployment = { cluster:context.cluster, genesis:context.genesis, authorizationProfile: profile, programId:VAULT_ID.toBase58(), verified:true, binarySha256:createHash('sha256').update(bytes).digest('hex'), binarySize:bytes.length, programData:programData.toBase58(), upgradeAuthority:null, deploymentSlot:1, deploymentSignature:null, upstreamCommit:'672fc6789b1532ee680f24842d235e0be8737b61' };
  if (isMainnet) {
    // LOCAL TEST FIXTURE ONLY: produce all six lifecycle transactions by
    // executing the real Mainnet SBF in LiteSVM before testing the launch gate.
    // This is neither a public deployment nor an independent security review.
    const proofRecipient = Keypair.generate().publicKey, bootstrap = new SolanaChain(manifest);
    bootstrap.connection = r.connection;
    bootstrap.wallet = { publicKey:payer.publicKey, connect:async()=>({publicKey:payer.publicKey}),disconnect:async()=>{},signTransaction:async tx=>{tx.partialSign(payer);return tx;} };
    bootstrap.validate = async () => bootstrap.validateDeployment();
    const e = new Engine(new MemoryStore(), bootstrap, PASSWORD);
    await e.create();
    async function verifiedBackup() { const value = await e.exportBackup(); await e.verifyBackup(value, PASSWORD); }
    await verifiedBackup(); await e.createOnChain(); await e.deposit(2_000_000n);
    for (let n=0;n<2;n++) { await e.prepareWithdrawal(1_000_000n, proofRecipient.toBase58()); await verifiedBackup(); await e.commitWithdrawal(); await e.executeWithdrawal(); }
    const i = await e.read();
    const proof: MainnetSmoke = {payer:payer.publicKey.toBase58(),recipient:proofRecipient.toBase58(),vaults:i.shells.map(s=>s.address) as MainnetSmoke['vaults'],depositLamports:'2000000',partialLamports:'1000000',signatures:i.attempts.map(a=>a.signature) as MainnetSmoke['signatures']};
    manifest.mainnetRelease = {status:'experimental-ready',compiledTestsPassed:true,sourceSha256:'ab'.repeat(32),securityReview:{status:'pending',reportUrl:null,reportSha256:null,reviewedSourceSha256:null,reviewedBinarySha256:null},experimentalLaunch:{mode:'owner-authorized-experimental',authorizationProfile:'mainnet-v2',programId:manifest.programId,sourceSha256:'ab'.repeat(32),binarySha256:manifest.binarySha256!,authorizedAt:'2026-10-11T00:00:00.000Z',disclosure:EXPERIMENTAL_DISCLOSURE},smoke:proof};
    for (const vault of [proof.vaults[0],proof.vaults[2]]) {
      const block=await r.connection.getLatestBlockhash('finalized');
      const donation=new Transaction({feePayer:payer.publicKey,...block}).add(SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:new PublicKey(vault),lamports:1}));donation.sign(payer);
      await r.connection.sendRawTransaction(donation.serialize());
    }
    const strict = new SolanaChain(manifest); strict.connection=r.connection; strict.historyConnection=r.connection; await strict.validate();
    const mismatchedHistory = new SolanaChain(manifest); mismatchedHistory.connection = r.connection;
    mismatchedHistory.historyConnection = new Connection('https://api.mainnet-beta.solana.com');
    mismatchedHistory.historyConnection.getGenesisHash = async () => DEVNET_GENESIS;
    await expect(mismatchedHistory.validate()).rejects.toThrow('RPC network mismatch');
  }
  const successes: string[] = [];
  async function install(p: Page) {
    await p.addInitScript(({ publicKey, seed }) => {
      const publicValue = { toBase58: () => publicKey };
      const provider = { publicKey: publicValue, connect: async () => ({ publicKey: publicValue }), disconnect: async () => {}, signTransaction: async (tx: { feePayer: unknown; serializeMessage(): Uint8Array; addSignature(key: unknown, signature: Uint8Array): void }) => {
        const prefix = [48,46,2,1,0,48,5,6,3,43,101,112,4,34,4,32];
        const key = await crypto.subtle.importKey('pkcs8', new Uint8Array([...prefix,...seed]), 'Ed25519', false, ['sign']);
        tx.addSignature(tx.feePayer, new Uint8Array(await crypto.subtle.sign('Ed25519', key, tx.serializeMessage()))); return tx;
      } };
      Object.assign(window,{phantom:{solana:provider}});
    }, { publicKey:payer.publicKey.toBase58(), seed:Array.from(payer.secretKey.subarray(0,32)) });
    await p.route(isMainnet ? '**/mainnet-deployment.json' : '**/deployment.json', route => route.fulfill({json:manifest}));
    await p.route(url => url.href === new URL(rpcForProfile(profile)).href || (isMainnet && (url.pathname === '/api/mainnet-rpc' || url.pathname === '/api/mainnet-history' || url.origin === 'https://api.mainnet-beta.solana.com')), async route => {
      const req = route.request().postDataJSON(); let result: unknown;
      const rpcContext = {slot:1};
      try {
        switch(req.method) {
          case 'getGenesisHash': result=context.genesis; break;
          case 'getAccountInfo': { const a=info(r.svm,new PublicKey(req.params[0]));result={context:rpcContext,value:a?{...a,owner:a.owner.toBase58(),data:[a.data.toString('base64'),'base64'],rentEpoch:0,space:a.data.length}:null};break; }
          case 'getBalance': result={context:rpcContext,value:Number(r.svm.getBalance(address(req.params[0]))??0n)};break;
          case 'getMinimumBalanceForRentExemption': result=Number(r.svm.minimumBalanceForRentExemption(BigInt(req.params[0])));break;
          case 'getLatestBlockhash': result={context:rpcContext,value:{blockhash:r.svm.latestBlockhash(),lastValidBlockHeight:1_000_000}};break;
          case 'getFeeForMessage': result={context:rpcContext,value:Message.from(Buffer.from(req.params[0],'base64')).header.numRequiredSignatures*5000};break;
          case 'sendTransaction': { const signature=await r.connection.sendRawTransaction(Buffer.from(req.params[0],'base64')); successes.push(signature);result=signature;break; }
          case 'getSignatureStatuses': { const s=await r.connection.getSignatureStatuses(req.params[0],{searchTransactionHistory:true});result={context:rpcContext,value:s.value.map(v=>v?{...v,slot:1,confirmations:null}:null)};break; }
          case 'getTransaction': {
            const tx=await r.connection.getTransaction(req.params[0]);
            if (!tx) {result=null;break;}
            const message=tx.transaction.message;
            result={...tx,transaction:{signatures:tx.transaction.signatures,message:{accountKeys:message.staticAccountKeys.map(k=>k.toBase58()),header:message.header,recentBlockhash:message.recentBlockhash,instructions:message.compiledInstructions.map(ix=>({programIdIndex:ix.programIdIndex,accounts:ix.accountKeyIndexes,data:Buffer.from(ix.data).toString('base64')}))}}};
            // RPC's JSON instruction data uses base58, not base64.
            const {getBase58Decoder}=await import('@solana/kit');
            (result as {transaction:{message:{instructions:{data:string}[]}}}).transaction.message.instructions.forEach((ix,n)=>{ix.data=getBase58Decoder().decode(message.compiledInstructions[n].data);});
            break;
          }
          case 'getBlockHeight': result=1;break;
          case 'getSignaturesForAddress': result=[];break; // Explorer indexing is outside this local fixture.
          default: throw Error(`Unhandled local RPC: ${req.method}`);
        }
        await route.fulfill({json:{jsonrpc:'2.0',id:req.id,result}});
      } catch(e) { await route.fulfill({json:{jsonrpc:'2.0',id:req.id,error:{code:-32000,message:(e as Error).message}}}); }
    });
  }
  async function backup(p: Page) {
    const download=p.waitForEvent('download');await p.getByRole('button',{name:'Download recovery file'}).click();const path=await(await download).path();
    await p.getByLabel('Choose your saved recovery file').setInputFiles(path!);await p.getByLabel('Recovery password',{exact:true}).fill(PASSWORD);await p.getByRole('button',{name:'Verify recovery file'}).click();return path!;
  }
  await install(page);await page.goto(routePath);await page.getByRole('button',{name:'Connect wallet',exact:true}).click();
  await expect(page.getByTestId('rpc-status')).toHaveText(`${isMainnet ? 'Mainnet' : 'Devnet'} RPC verified`);await expect(page.getByTestId('deployment-status')).toHaveCount(0);
  await page.getByRole('button',{name:'Create your vault',exact:true}).click();await page.getByLabel('Choose a recovery password').fill(PASSWORD);await page.getByLabel('Confirm recovery password').fill(PASSWORD);await page.getByRole('button',{name:'Create vault',exact:true}).click();await backup(page);
  let directSpendable = 0n;
  if (isMainnet) {
    // Disposable VM accounts only: reproduce a direct transfer to the still
    // uninitialized PDA, and a connected wallet holding only activation fees.
    const localAddress = (await page.locator('.full-address').textContent())!, donor = r.admins[1];
    const funding = new Transaction({ feePayer: donor.publicKey, recentBlockhash: r.svm.latestBlockhash() }).add(SystemProgram.transfer({ fromPubkey: donor.publicKey, toPubkey: new PublicKey(localAddress), lamports: 90_998_331 }));
    funding.sign(donor); await r.connection.sendRawTransaction(funding.serialize());
    const account = r.svm.getAccount(address(payer.publicKey.toBase58()));
    r.svm.setAccount({ ...account, address: address(payer.publicKey.toBase58()), lamports: lamports(10_000n + activationPlatformFee(profile)) });
    await page.getByRole('button', { name: 'Refresh finalized balances' }).click();
    await expect(page.locator('.vault-card .balance')).toContainText('0.090998331');
    await expect(page.locator('.vault-card')).toContainText('SOL awaiting activation');
    await expect(page.getByRole('button', { name: 'Add SOL', exact: true })).toBeDisabled();
    await page.getByText('Fees and rent', { exact: true }).click();
    await expect(page.getByTestId('activation-cost')).toContainText('0.000010000 SOL transaction fee + 0.000000000 SOL rent top-up');
    directSpendable = 90_998_331n - r.svm.minimumBalanceForRentExemption(172n);
    await page.reload();
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await page.getByRole('button', { name: 'Unlock saved vault', exact: true }).click();
    await page.getByLabel('Recovery password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Unlock vault', exact: true }).click();
    await expect(page.locator('.full-address')).toHaveText(localAddress);
    await expect(page.locator('.vault-card .balance')).toContainText('0.090998331');
    await expect(page.locator('.vault-card')).toContainText('SOL awaiting activation');
  }
  const platformBalanceBefore = r.svm.getBalance(address(PLATFORM_FEE_RECIPIENT)) ?? 0n;
  await page.getByRole('button',{name:'Activate vault',exact:true}).click();
  if (isMainnet) {
    await expect(page.getByTestId('activation-platform-fee')).toContainText('0.010000000 SOL');
    await expect(page.getByTestId('activation-total')).toContainText('0.010010000 SOL');
    await page.getByText('Platform fee recipient', { exact: true }).click();
    await expect(page.getByTestId('platform-fee-recipient')).toHaveText(PLATFORM_FEE_RECIPIENT);
  }
  await page.getByRole('button',{name:'Approve activation in wallet',exact:true}).click();
  await expect(page.getByRole('button',{name:'Add SOL',exact:true})).toBeEnabled();
  expect(r.svm.getBalance(address(PLATFORM_FEE_RECIPIENT)) ?? 0n).toBe(platformBalanceBefore + activationPlatformFee(profile));
  if (isMainnet) {
    await expect(page.locator('.vault-card')).toContainText('SHELL vault');
    await expect(page.locator('.vault-card .balance')).toContainText(formatSol(directSpendable));
    expect(r.svm.getBalance(address(payer.publicKey.toBase58())) ?? 0n).toBe(0n);
    r.svm.airdrop(address(payer.publicKey.toBase58()), lamports(10_000_000_000n));
    await page.getByRole('button', { name: 'Refresh finalized balances' }).click();
  }
  await page.getByRole('button',{name:'Add SOL',exact:true}).click();await page.getByLabel('Amount in SOL',{exact:true}).fill('0.100000000');await page.getByRole('button',{name:'Approve deposit in wallet'}).click();await expect(page.locator('.vault-card .balance')).toContainText(formatSol(100_000_000n + directSpendable));
  await page.getByRole('button',{name:'Send SOL',exact:true}).click();await page.locator('.input-action input').fill('0.040000000');await page.getByLabel('Recipient’s Solana address').fill(recipient.toBase58());await page.getByRole('button',{name:'Prepare send & save backup'}).click();const rotationBackup=await backup(page);
  await page.getByRole('button',{name:`Confirm send details on ${networkLabel}`}).click();await page.getByRole('button',{name:'Send SOL & change keys'}).click();await expect(page.locator('.vault-card .balance')).toContainText(formatSol(60_000_000n + directSpendable));
  expect(r.svm.getBalance(address(recipient.toBase58()))).toBe(40_000_000n);
  const current=await page.locator('.full-address').textContent(), clean=await browser.newContext(), recovered=await clean.newPage();await install(recovered);await recovered.goto(routePath);await recovered.getByRole('button',{name:'Connect wallet',exact:true}).click();await recovered.getByRole('button',{name:'Restore vault',exact:true}).click();await recovered.getByLabel('Encrypted SHELL package').setInputFiles(rotationBackup);await recovered.getByLabel('Recovery password',{exact:true}).fill(PASSWORD);await recovered.getByRole('button',{name:'Restore from file'}).click();await expect(recovered.locator('.full-address')).toHaveText(current!);
  await recovered.getByRole('button',{name:'Send SOL',exact:true}).click();await recovered.getByRole('button',{name:'Full balance',exact:true}).click();await recovered.getByLabel('Recipient’s Solana address').fill(recipient.toBase58());await recovered.getByRole('button',{name:'Prepare send & save backup'}).click();await backup(recovered);await recovered.getByRole('button',{name:`Confirm send details on ${networkLabel}`}).click();await recovered.getByRole('button',{name:'Send SOL & change keys'}).click();await expect(recovered.locator('.vault-card .balance')).toContainText('0.000000000');
  expect(r.svm.getBalance(address(recipient.toBase58()))).toBe(100_000_000n + directSpendable);expect(successes.length).toBe(6);expect(r.svm.getBalance(address(PLATFORM_FEE_RECIPIENT)) ?? 0n).toBe(platformBalanceBefore + activationPlatformFee(profile));await clean.close();
});
