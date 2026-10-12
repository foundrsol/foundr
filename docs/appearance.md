Current funding policy: [owner-authorized experimental Mainnet release](experimental-launch.md). Earlier review-gated release notes below describe the previous policy.

Current funding policy: [owner-authorized experimental Mainnet release](experimental-launch.md). Earlier review-gated release notes below describe the previous policy.

Current funding policy: [owner-authorized experimental Mainnet release](experimental-launch.md). Earlier review-gated release notes below describe the previous policy.

# Light and dark appearance

Use the sun/moon switch beside Wallet and How it Works in the header. The same switch appears on the protocol page. Light is the default. Dark uses navy surfaces and mint controls; balances, dialogs, inputs, errors and transaction states share the selected palette.

The browser saves only `light` or `dark` under the non-secret `shell-appearance` local-storage key. The fixed inline bootstrap applies it before the application hydrates, avoiding a bright initial palette on dark reloads. Other tabs on the same origin update through the storage event. Keyboard Space/Enter works through the native button, exposed as an accessible switch. If preference storage is blocked, switching still works for the current page; reload returns to light. Appearance does not touch encrypted identities, backups, signing state or transaction construction.

[Appearance verification](appearance.json) records the exact release, public deployment and executed checks. The standard local release suite passed in light mode; all 17 public browser checks passed with a saved dark preference. Clean-profile recovery also covers default light. Actual compiled-program withdrawal tests use local SBF fixtures, and no new Mainnet transaction was submitted. The immutable program and independent-review funding gate remain in place.

To reproduce the saved-dark browser run, copy `docs/test-results/appearance-playwright.config.txt` to `.dev/appearance-playwright.config.ts`, set `SHELL_BROWSER_URL` to the actual website, and run `npm run test:browser -- --config .dev/appearance-playwright.config.ts`. In the managed environment, retain the configured browser proxy. `docs/test-results/appearance-preview-script.mjs.txt` can likewise be copied to `.dev/preview-appearance.mjs` and run with Node 24 for layout and preference checks. These files contain only public configuration and disposable UI checks.

The original appearance evidence below records the prior release. See [current navigation and onboarding evidence](guidance.json) for the latest source, deployment and browser checks. The Devnet selector has been removed from public navigation.
