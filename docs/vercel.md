Current release: [experimental Mainnet launch](experimental-launch.md). Earlier review-gated interface updates below remain historical evidence.

Current release: [experimental Mainnet launch](experimental-launch.md). Earlier review-gated interface updates below remain historical evidence.

Current release: [experimental Mainnet launch](experimental-launch.md). Earlier review-gated interface updates below remain historical evidence.

Current release: [experimental Mainnet launch](experimental-launch.md). Earlier review-gated interface updates below remain historical evidence.

# Public website and Vercel deployment

The tested current release is publicly available at **https://sonic-perseus-9a1cxls.vercel.app** on Vercel. It serves the actual Next.js static export with the full wallet, recovery, protocol and CA interfaces. [vercel-evidence.json](vercel-evidence.json) records the real production deployment, public route verification, security headers and exact manifest hashes. All 17 Chromium checks passed at that HTTPS origin in [vercel-public-browser.txt](test-results/vercel-public-browser.txt).

Vercel publishes the static website and a fixed external Mainnet RPC rewrite. The Mainnet vault program was separately deployed immutably, and its owner-operated lifecycle passed. [Actual Mainnet evidence](mainnet.md) records that deployment. Public funding remains gated on independent review. No tradable token has been created.

## Actual production deployment

The user completed Vercel account sign-in. CLI 59.11.7 authenticated as `javieradriano99-5764` and linked the existing claimed project `prj_lMkS00R8PigQSpkzm5Qf2xcVzmuE`, `foundr2/sonic-perseus-9a1cxls`. The actual deployment is `dpl_GZvTPfaqVpGX9aPy6855fyKU57eJ`, with target `production` and state `READY`.

Authenticated inspection confirms the public production alias and the older `temporary-sonic-perseus-9a1cxls.vercel.app` alias point to this new deployment; see [vercel-provider-inspection.json](vercel-provider-inspection.json). The unique build URL `https://sonic-perseus-9a1cxls-j0ew4tmz1-foundr2.vercel.app` redirects unauthenticated visitors to Vercel sign-in. Verification uses the API-confirmed public production alias, preserving the canonical build URL in evidence. No deployment-protection setting was disabled.

The earlier Sites publication remains at https://shell-security-vault.javieradriano99.chatgpt.site. [mainnet-website.json](mainnet-website.json) preserves its exact version and Git source commit. Earlier anonymous Vercel evidence is retained in [vercel-anonymous-evidence.json](vercel-anonymous-evidence.json).

## Republish to the claimed Vercel project

Use Node 24. `vercel.json` configures the exact lockfile, webpack build, static `out/` directory, separate Mainnet and Devnet profiles and security headers. `scripts/prepare-vercel.mjs` produces Build Output API v3 assets with explicit `/devnet` and `/protocol` routing, no-store public manifest headers, and a fixed POST-only `/api/mainnet-rpc` rewrite to `https://solana-rpc.publicnode.com/`; other methods receive HTTP 405. The application requires no web-server secrets. [vercel-preflight.json](vercel-preflight.json) records the upload preparation and actual local verification.

In an authenticated terminal:

    cd /workspace/shell
    export NODE_USE_ENV_PROXY=1 NO_UPDATE_NOTIFIER=1 VERCEL_TELEMETRY_DISABLED=1
    npm run build -- --webpack
    node scripts/prepare-vercel.mjs
    npm exec --cache .cache/npm --yes --package=vercel@59.11.7 -- vercel login --global-config .dev/vercel
    npm exec --cache .cache/npm --yes --package=vercel@59.11.7 -- vercel link --yes --project prj_lMkS00R8PigQSpkzm5Qf2xcVzmuE --global-config .dev/vercel
    npm exec --cache .cache/npm --yes --package=vercel@59.11.7 -- vercel deploy --prebuilt --prod --yes --global-config .dev/vercel

Select the account/team that claimed SHELL. Never paste an account token in chat or put it in public source. Production publication does not enable Solana funding.

After deployment, inspect its actual public alias with `vercel inspect <actual-public-alias> --json`. Confirm the inspection ID matches the deployment ID, its target/state are `production`/`READY`, and its returned `aliases` include that public hostname. Save the actual deployment result in ignored `.dev/vercel-deployment.json`. When the unique build URL requires Vercel sign-in, use the confirmed public alias as the verification object's `deployment.url`, retain the original as `canonicalDeploymentUrl`, and explicitly record that the verification target is the public production alias. This changes only the HTTP verification target; it does not invent deployment metadata or bypass Vercel access protection.

Run `node scripts/verify-vercel.mjs`. Verification requires a real `READY` deployment, working Mainnet/Devnet/protocol routes, security headers, no-store manifests and byte-for-byte equality with the tested export. It checks the actual RPC rewrite's complete Mainnet genesis, no-store response, POST-only behavior, removed homepage sentence and private-file 404s. Run the browser suite against that HTTPS origin with `SHELL_BROWSER_URL=<actual-public-alias> SHELL_LIVE_RPC=1 npm run test:browser`; in this managed environment also set `SHELL_BROWSER_PROXY` to the inherited HTTPS proxy. A production-only regression deliberately blocks direct browser access to PublicNode and still requires a verified Mainnet RPC through the relay. These checks are read-only against live RPCs; vault lifecycle transactions use local compiled-program fixtures.

## Secrets and origins

Ignored `.dev/`, `.toolchains/`, dependency caches, local environment files, SQLite state and development keys are excluded from publication/source archives. The Sites Git token was passed through hidden stdin, kept only in process memory, and never persisted in Git configuration or an archive. The plugin's bundled helper was unavailable, so `scripts/sites-publish-source.py` performed equivalent credential-safe commit/push/archive preparation; the native version/deployment tools published the exact pushed static source.

Vercel account credentials stay in private ignored `.dev/vercel/` (directory mode 700; auth file mode 600). Vercel link created an ignored `.env.local` for its OIDC credential. Application code does not reference that credential or expose it through public environment variables. The static export and upload contain only public assets. The published prebuilt bundle contains only public `out/` assets and routing configuration. HTTP checks for `/.env.local`, `/.mainnet/program.json` and `/.dev/vercel/auth.json` all returned 404.

Cryptographic operations remain client-side; no recovery file, password or vault key is uploaded. No analytics or error tracker is included. `/devnet` uses `https://api.devnet.solana.com`; Mainnet pins `https://solana-rpc.publicnode.com`, reached through `/api/mainnet-rpc` on HTTPS production origins. The relay carries public queries and signed transactions only, omits cookies, disallows redirects and has no secret RPC credential. Both profiles validate the full official genesis hash. Unverified deployments keep funding disabled. Hosting and RPC operators remain trusted transport dependencies.

Browser storage belongs to its origin. To move between Sites, Vercel or a custom domain, export and verify the latest package at the old origin and Recover it at the new trusted origin. Do not silently create a replacement for a funded identity.

## Minimalist interface update

The current production release uses a light, single-card wallet with system typography. Costs, deployment details and diagnostics expand when needed. Recovery, transaction review and signing gates are retained. [Current interface evidence](guidance.json) records exact-source checks and desktop/phone viewport verification against this public release. No Solana transaction was submitted for this update.

## Appearance option

Use the sun/moon switch next to Wallet and How it Works. Light is the default; the saved choice is applied before hydration and synchronized across tabs. All 17 public browser checks passed with dark appearance configured, while clean-browser recovery also covers default light. [Appearance evidence](appearance.json) records keyboard use, reload/navigation persistence, blocked-storage fallback and inspected desktop/mobile forms. This website update submitted no Solana transaction.

## Clearer setup and navigation

Public navigation now contains Wallet and How it Works. Devnet has no public selector or recommendation; its direct route is retained for engineering checks. The three-step guide explains local creation, recovery-file verification and adding/sending SOL. The wallet shows its next step and uses Create your vault, Activate vault, Add SOL, Send SOL, Back up vault and Restore vault. Dialog actions are named consistently. The light/dark switch remains available. [Current verification](guidance.json) records actual local and public tests and phone layouts. Public funding is still gated on independent exact-build review.
