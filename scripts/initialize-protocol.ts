// Disposable DEVNET mints and controlled liquidity only. Never a mainnet token.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { Keypair, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from '@solana/web3.js';
import { BN } from '@anchor-lang/core';
import { TOKEN_PROGRAM_ID, MINT_SIZE, ACCOUNT_SIZE, NATIVE_MINT, getAssociatedTokenAddressSync, createInitializeMint2Instruction, createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, createSyncNativeInstruction } from '@solana/spl-token';
import { ProtocolClient, PROTOCOL_ID, configAddress, bankAddress, poolAddress, pda, toAnchor, type ProtocolDeployment } from '../src/protocol/client.ts';
import { SolanaChain, explorer } from '../src/solana/chain.ts';
import { testRules } from '../src/protocol/fees.ts';
import { base58, b64, from64 } from '../src/core/bytes.ts';
await mkdir('.dev',{recursive:true,mode:0o700});
async function key(name: string) { const bytes=Uint8Array.from(JSON.parse(await readFile(`.dev/${name}.json`,'utf8')));try{return Keypair.fromSecretKey(bytes);}finally{bytes.fill(0);} }
const authority=await key('deployer'), admins=[authority,await key('admin2'),await key('admin3')], treasury=await key('treasury'), shell=await key('test-shell-mint'), quote=await key('test-quote-mint');
const manifest=JSON.parse(await readFile('public/protocol-deployment.json','utf8')) as ProtocolDeployment, client=new ProtocolClient(manifest), connection=client.connection;
await new SolanaChain(JSON.parse(await readFile('public/deployment.json','utf8'))).validate(); await client.verifier.validate();
if(manifest.upgradeAuthority!==authority.publicKey.toBase58()) throw Error('The explicitly configured development authority is required');
const steps: {name:string;signature:string;raw:string;height:number;state:string}[] = await readFile('.dev/protocol-setup-journal.json','utf8').then(JSON.parse).catch(()=>[]);
const persist=()=>writeFile('.dev/protocol-setup-journal.json',JSON.stringify(steps,null,2)+'\n',{mode:0o600});
async function send(name:string,instructions:TransactionInstruction[],signers:Keypair[]=[authority]) {
  const old=steps.findLast(s=>s.name===name);
  if(old?.state==='confirmed') return old.signature;
  if(old) {
    const status=(await connection.getSignatureStatuses([old.signature],{searchTransactionHistory:true})).value[0];
    if(status?.confirmationStatus==='finalized') {old.state=status.err?'failed':'confirmed';await persist();if(!status.err)return old.signature;}
    else if(status || await connection.getBlockHeight('finalized')<=old.height) {try{await connection.sendRawTransaction(from64(old.raw),{skipPreflight:false,maxRetries:0});}catch{}throw Error(`Setup ${name} has an unknown outcome. Journal retained; run again after reconciliation.`);}
  }
  const block=await connection.getLatestBlockhash('finalized'), tx=new Transaction({feePayer:authority.publicKey,...block}).add(...instructions);tx.sign(...signers);const raw=tx.serialize();
  const item={name,signature:base58(tx.signature!),raw:b64(raw),height:block.lastValidBlockHeight,state:'submitting'};steps.push(item);await persist();
  try {
    if(await connection.sendRawTransaction(raw,{skipPreflight:false,maxRetries:0,preflightCommitment:'finalized'})!==item.signature)throw Error('Unexpected RPC signature');
    const result=await connection.confirmTransaction({signature:item.signature,...block},'finalized');if(result.value.err){item.state='failed';await persist();throw Error(`Setup ${name} failed on chain`);}item.state='confirmed';await persist();return item.signature;
  }catch(e){if(item.state!=='failed')item.state='outcome unknown';await persist();throw e;}
}
for(const [name,mint] of [['shell',shell],['quote',quote]] as const) if(!await connection.getAccountInfo(mint.publicKey,'finalized')) {
  await send(`mint-${name}`,[SystemProgram.createAccount({fromPubkey:authority.publicKey,newAccountPubkey:mint.publicKey,lamports:await connection.getMinimumBalanceForRentExemption(MINT_SIZE),space:MINT_SIZE,programId:TOKEN_PROGRAM_ID}),createInitializeMint2Instruction(mint.publicKey,6,authority.publicKey,null)],[authority,mint]);
}
const shellAccount=getAssociatedTokenAddressSync(shell.publicKey,authority.publicKey), quoteAccount=getAssociatedTokenAddressSync(quote.publicKey,authority.publicKey), nativeAccount=getAssociatedTokenAddressSync(NATIVE_MINT,authority.publicKey);
for(const [mint,account] of [[shell.publicKey,shellAccount],[quote.publicKey,quoteAccount],[NATIVE_MINT,nativeAccount]]) await send(`ata-${mint.toBase58()}`,[createAssociatedTokenAccountIdempotentInstruction(authority.publicKey,account,authority.publicKey,mint)]);
await send('mint-disposable-shell-liquidity',[createMintToInstruction(shell.publicKey,shellAccount,authority.publicKey,4_000_000_000_000n)]);
await send('mint-disposable-quote-liquidity',[createMintToInstruction(quote.publicKey,quoteAccount,authority.publicKey,10_000_000_000n)]);
await send('wrap-devnet-liquidity',[SystemProgram.transfer({fromPubkey:authority.publicKey,toPubkey:nativeAccount,lamports:1_000_000_000n}),createSyncNativeInstruction(nativeAccount)]);
if(!await connection.getAccountInfo(configAddress(),'finalized')) await send('initialize-config',[await client.instruction('initialize',[admins.map(a=>a.publicKey),treasury.publicKey,toAnchor(testRules())],{authority:authority.publicKey,protocol:PROTOCOL_ID,programData:new PublicKey(manifest.programData!),config:configAddress(),nativeBuyback:bankAddress('native-buyback'),nativeTreasury:bankAddress('native-treasury'),shellMint:shell.publicKey,quoteMint:quote.publicKey,splBuyback:bankAddress('spl-buyback'),splTreasury:bankAddress('spl-treasury'),burnAccount:bankAddress('burn'),tokenProgram:TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId})]);
for(const [mint,source,amount] of [[NATIVE_MINT,nativeAccount,1_000_000_000n],[quote.publicKey,quoteAccount,1_000_000_000n]] as const) {
  const pool=poolAddress(mint);if(await connection.getAccountInfo(pool,'finalized'))continue;
  await send(`test-pool-${mint.toBase58()}`,[await client.instruction('createTestPool',[new BN(amount.toString()),new BN('1000000000000')],{admin:authority.publicKey,config:configAddress(),quoteMint:mint,shellMint:shell.publicKey,pool,poolQuote:pda('pool-quote',pool.toBytes()),poolShell:pda('pool-shell',pool.toBytes()),adminQuote:source,adminShell:shellAccount,tokenProgram:TOKEN_PROGRAM_ID,systemProgram:SystemProgram.programId},[{pubkey:admins[1].publicKey,isSigner:true,isWritable:false}])],[authority,admins[1]]);
}
Object.assign(manifest,{shellMint:shell.publicKey.toBase58(),quoteMint:quote.publicKey.toBase58(),admins:admins.map(a=>a.publicKey.toBase58()),treasuryRecipient:treasury.publicKey.toBase58()});
await new ProtocolClient(manifest).validate(); await writeFile('public/protocol-deployment.json',JSON.stringify(manifest,null,2)+'\n');
const evidence={network:'devnet',programId:manifest.programId,shellTestMint:manifest.shellMint,quoteTestMint:manifest.quoteMint,config:configAddress().toBase58(),testPoolsOnly:true,transactions:steps.filter(s=>s.state==='confirmed').map(s=>({name:s.name,signature:s.signature,explorer:explorer(s.signature)})),completedAt:new Date().toISOString(),note:'Three disposable admin keys belong to the same development environment. This is not independent production governance.'};
await writeFile('docs/protocol-devnet-evidence.json',JSON.stringify(evidence,null,2)+'\n');console.info(JSON.stringify(evidence,null,2));
