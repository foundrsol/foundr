import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
test('actual React page renders devnet banner, separate balances and real funding gates', async () => {
  await mkdir('.dev', { recursive: true });
  const source = await readFile('app/components/VaultApp.tsx', 'utf8');
  const module = ts.transpileModule(source, { fileName: 'page.tsx', compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } });
  const path = new URL('../.dev/ssr-view-test.mjs', import.meta.url);
  const tokenPath = new URL('../.dev/ssr-token-test.mjs', import.meta.url);
  const appearancePath = new URL('../.dev/ssr-appearance-test.mjs', import.meta.url);
  const navigationPath = new URL('../.dev/ssr-navigation-test.mjs', import.meta.url);
  const tokenSource = await readFile('app/components/TokenAddress.tsx', 'utf8');
  await writeFile(tokenPath, ts.transpileModule(tokenSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText);
  await writeFile(appearancePath, ts.transpileModule(await readFile('app/components/AppearanceToggle.tsx', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText);
  await writeFile(navigationPath, ts.transpileModule(await readFile('app/components/SiteNavigation.tsx', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText.replace('./AppearanceToggle', './ssr-appearance-test.mjs'));
  await writeFile(path, module.outputText.replace('./TokenAddress', './ssr-token-test.mjs').replace('./SiteNavigation', './ssr-navigation-test.mjs').replaceAll('../../src/', '../src/'));
  try {
    const { default: Home } = await import(path.href);
    const html = renderToStaticMarkup(createElement(Home, { network: 'devnet' }));
    assert.match(html, /DEVNET — TEST FUNDS ONLY/); assert.match(html, /Connected wallet/); assert.match(html, /SHELL vault/);
    assert.match(html, /disabled=""[^>]*>Add SOL/); assert.match(html, /protected only after|finalized devnet check/);
    assert.match(html, /Create your vault/); assert.match(html, /Send SOL/); assert.match(html, /Restore vault/);
    assert.doesNotMatch(html, /coordinatorSeed|0\.000000000 SOL|unhackable|AI-proof/);
    const mainnet = renderToStaticMarkup(createElement(Home, { network: 'mainnet-beta' }));
    assert.doesNotMatch(mainnet, /MAINNET — REAL SOL|devnet-banner/); assert.match(mainnet, /aria-current="page">Wallet/); assert.doesNotMatch(mainnet, /DEVNET — TEST FUNDS ONLY|href="\/devnet"/);
    assert.match(mainnet, /href="\/how-it-works"/); assert.match(mainnet, /Start here: create your vault, then save its recovery file/);
    assert.match(mainnet, /disabled=""[^>]*>Add SOL/); assert.match(html, /Contract address pending/); assert.match(html, /Copy SHELL contract address/);
  } finally { await unlink(path); await unlink(tokenPath); await unlink(appearancePath); await unlink(navigationPath); }
});
