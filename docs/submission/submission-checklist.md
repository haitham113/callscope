# CallScope submission checklist

Checked items are backed by repository or validation evidence. External publication items remain unchecked until verified live.

## Product and repository

- [x] Functional Vue/Vite source is present in the public-repository candidate.
- [x] MIT license exists at the repository root.
- [x] README explains value, WebMCP necessity, exact tools, approval separation, second prompt, setup, architecture, privacy, browser support, tests, and limitations.
- [x] Architecture document matches the implemented capability boundaries and browser-only runtime.
- [x] No optional detached-track fault, backend, authentication, database, PBX, TURN, or autonomous recovery was added.
- [x] Confirm the GitHub repository is publicly accessible in a signed-out browser.
- [ ] Confirm commit history is within the challenge period.

## Deployment

- [x] Intended HTTPS URL is documented: <https://haitham113.github.io/callscope/>.
- [x] GitHub Pages workflow builds and deploys static `dist/` from `main`.
- [ ] Deploy the Milestone 6 commit after explicit authorization.
- [ ] Confirm the deployed bundle contains the bitrate fault and Milestone 6 polish.
- [ ] Run the full deployed Chrome suite without a 404, console error, or unhandled rejection.
- [ ] Complete the two-prompt golden path in ChatGPT's in-app browser.
- [ ] Complete the audio and bitrate paths through the installed WebMCP plugin on the deployed origin.

## Submission assets

- [x] Healthy screenshot: [`../screenshots/01-healthy.png`](../screenshots/01-healthy.png).
- [x] Staged recovery screenshot: [`../screenshots/02-staged-recovery.png`](../screenshots/02-staged-recovery.png).
- [x] Approved-but-still-broken screenshot: [`../screenshots/03-approved-still-broken.png`](../screenshots/03-approved-still-broken.png).
- [x] Before/after recovery screenshot: [`../screenshots/04-before-after-recovery.png`](../screenshots/04-before-after-recovery.png).
- [x] English challenge description is drafted.
- [x] Exact 2:30 demo script is drafted with both prompts.
- [x] Public YouTube recording checklist is drafted.
- [ ] Record, upload, and verify a public YouTube video under three minutes.
- [ ] Add the public YouTube URL to the challenge submission.

## Final judge readiness

- [ ] Open the live URL from a clean signed-out supported client.
- [ ] Reach Healthy with one click and no permission request.
- [ ] Complete three consecutive deployed audio-rescue rehearsals and record each duration.
- [ ] Verify approval alone leaves the actual track disabled.
- [ ] Verify the explicit second prompt resumes apply → compare → report.
- [ ] Verify manual recovery remains usable without WebMCP.
- [ ] Verify laptop, tablet, and stacked mobile layouts without horizontal overflow.
- [ ] Verify keyboard navigation, visible focus, contrast, and reduced motion.
- [ ] Verify loading, unsupported, empty, error, end, and reset states.
- [ ] Confirm no console errors or unhandled rejections through the entire path.
- [ ] Submit only after every external item above is checked and live evidence is recorded.
