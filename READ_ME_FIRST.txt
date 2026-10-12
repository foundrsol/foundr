SHELL project source and public program artifacts

Start with README.md for setup, deployment, recovery and limitations.
The package includes atomic 0.01 SOL fees for each new vault activation,
the direct-transfer balance fix, simplified How it Works and dark mode.
Automatic rotations have no platform fee. Wallet and recovery secrets are excluded.

Requirements: Node.js 24 or newer, npm, and access to npm for installation.

Extract project.zip, open a terminal in SHELL, then run:
  npm ci
  npm run dev

For the local tests:
  node -e "for (const p of ['.dev','.mainnet']) require('node:fs').mkdirSync(p,{recursive:true})"
  npm test
  npm run test:programs
  npx playwright install chromium
  npm run test:browser

The three compiled public program binaries are included, so compiled-program
checks do not require rebuilding Rust first. Rebuild instructions and exact
upstream versions/licenses are in README.md, docs/ and source-lock.json.

The default UI uses Mainnet. A bare Next development server does not host the
Vercel history function, so live funding stays gated locally. Browser tests use
explicit disposable compiled-program fixtures. Deployed verification requires
the read-only history function and RPC routes in scripts/prepare-vercel.mjs.
Use your own hosting account; Vercel credentials and project login are omitted.
No user's funds are moved by installing, building or running the tests above.

The source includes experimental SOL vault authorization and the public
immutable Mainnet program configuration. Read the architecture/recovery docs
before using real funds. No token mint or liquidity pool is created.

Excluded: private wallets, recovery packages, passwords, API credentials,
node_modules, local cache, private deployment state and hosting credentials.
