Current funding policy: [owner-authorized experimental Mainnet release](experimental-launch.md). Earlier review-gated release notes below describe the previous policy.

Current funding policy: [owner-authorized experimental Mainnet release](experimental-launch.md). Earlier review-gated release notes below describe the previous policy.

Current funding policy: [owner-authorized experimental Mainnet release](experimental-launch.md). Earlier review-gated release notes below describe the previous policy.

Current funding policy: [owner-authorized experimental Mainnet release](experimental-launch.md). Earlier review-gated release notes below describe the previous policy.

# Simple wallet setup

The public header has Wallet and How it Works, plus the existing dark-mode switch. There is no public Devnet option. The direct `/devnet` and `/protocol` routes remain for developer verification with their test-funds banners and isolated encrypted identities; they are not linked from the public wallet or guide.

The guide has three steps: create the separate local vault, download and verify its recovery file, then connect/activate/add or send SOL when checks pass. One short line on the wallet explains the current next step. Actions are named Create your vault, Unlock saved vault, Save recovery file, Activate vault, Add SOL, Send SOL, Back up vault, Restore vault and Lock vault. Sending still requires an updated verified backup, permanent operation commitment, separate one-time authorization and rotation. Unknown outcomes can only be checked or retried as the same operation. Actual approval previews retain fees, permanent rent, recipient and change destinations.

[Executed verification](guidance.json) includes the exact source and actual Vercel deployment. All 54 unit tests, three compiled-SBF matrices and the local browser suite passed. All 17 public browser checks passed in saved dark mode; clean-profile recovery also covers default light. A navigation check opens the guide, preserves appearance, checks 320px layout and returns to the setup action. The disposable withdrawal flows execute actual compiled programs in local VMs. Live RPC verification is read-only; this UI update submitted no Mainnet transactions.

The production program is already immutable and its owner lifecycle has historical finalized evidence. Public funding remains paused for independent security review of the exact source/build. The missing review has not been replaced with local tests or a fabricated approval.

The original [appearance evidence](appearance.json) is retained as history. To reproduce the current manual checks, copy `docs/test-results/guidance-preview-script.mjs.txt` to `.dev/preview-guidance.mjs`, set `SHELL_BROWSER_URL`, and run it with Node 24 and the browser proxy configured when required. The saved-dark Playwright configuration in `docs/test-results/appearance-playwright.config.txt` remains compatible with the current tests.
