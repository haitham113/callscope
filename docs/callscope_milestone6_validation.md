# Milestone 6 validation record

Date: 2026-09-01
Scope: production reliability, judge-facing polish, synchronized documentation, and submission readiness only

## Gate summary

| Environment | Result | Evidence |
| --- | --- | --- |
| Local production preview in Chrome | **PASS** | Full manual and WebMCP audio/video flows, negative paths, responsive/accessibility checks, screenshots, repeated rehearsals, and console/unhandled-error assertions passed. |
| Installed WebMCP Inspector 1.9.13 against public deployment | **PASS** | Exact discovery of all seven tools plus native extension-message audio and bitrate rescues passed in a disposable Chrome profile in 17.30s. |
| Isolated candidate clone with fresh dependencies | **PASS** | `npm ci`, 124 tests, lint, and production build passed; npm reported 0 vulnerabilities. |
| Public repository | **PASS** | `origin/main` resolves to Milestone 6 commit `5ea9b2b`; signed-out HTTPS returned 200 and the candidate safety scan found no secret-like paths/patterns, tracked generated directories, or files over 5 MB. |
| Current public deployment | **FINAL CONTRAST PATCH PENDING** | The complete deployed Chrome suite passed 31/31 in 1.2 minutes and the strengthened mobile flow passed. A broader visible-text audit then found the active “Start and watch” caption at 3.92:1; the one-rule local correction passes across idle, healthy, staged, approved, and recovered states but is not deployed yet. |
| ChatGPT in-app browser | **NOT VERIFIED** | This supported client is unavailable from the current environment. |
| Public YouTube recording and challenge submission | **NOT COMPLETED** | Checklists and exact script exist; no recording was fabricated or uploaded and nothing was submitted. |

Milestone 6's implementation passes locally, and the deployed functional/WebMCP gates pass. The strict deployed judge-readiness exit condition remains pending until the final contrast correction is pushed and reverified and the two-prompt path is manually verified in ChatGPT's in-app browser. Public video publication and challenge submission also remain external manual steps.

## Judge-facing polish verified locally

- Operations-console hierarchy includes a five-step Observe → Diagnose → Approve → Recover → Verify strip.
- Health state is the dominant status element, uses polite live announcements, and changes with restrained 180ms transitions.
- Timeline actor badges visibly distinguish User, Agent, and System; Agent tool titles render as exact monospace tool names.
- The staged plan explains that approval records consent only and keeps the real media fault unchanged.
- The approved state says the media is still broken, displays the exact continuation prompt, and places **Apply manually** behind a visibly secondary “No agent available?” fallback.
- Unsupported WebMCP state remains visible and explains that the full manual rescue needs no credentials or extension.
- Loading, empty, error, ended/reset, and cleanup states have explicit judge-facing copy.
- A skip link, keyboard activation, visible focus, calculated WCAG AA body-text contrast, polite status announcements, and reduced-motion behavior are covered.
- 820×1180 tablet and 390×844 stacked mobile checks pass without horizontal overflow; the mobile check completes the full fault → plan → approve → manual apply → recovered report path and rechecks overflow afterward.
- Console errors and uncaught page errors are collected and required to remain empty in polish, screenshot, rehearsal, and golden-path browser tests.

## Commands and actual results

Final working-tree gates:

- `npm test` — **PASS**, 23 files / 124 tests, 2.56s wall time.
- `npm run lint` — **PASS**, no errors or warnings, 2.35s wall time.
- `npm run build` — **PASS**, 40 modules; 0.90 kB HTML, 25.73 kB CSS, 183.94 kB JS before gzip; 2.51s wall time.
- `npm run test:browser` — **PASS**, 35 passed / 2 expected skips, 92.44s wall time. The skips were native WebMCP discovery in an ordinary Chrome profile and the opt-in installed-extension test.
- `npm run test:spikes` — **PASS**, generated media/repeated negotiation/sender readback passed; native WebMCP discovery skipped in the ordinary profile; 5.33s wall time.
- `npm run capture:screenshots` — **PASS**, four real-browser submission states, final run 9.2s.
- `CALLSCOPE_WEBMCP_USER_DATA_DIR=<disposable-profile> npm run test:plugin` against the deployment — **PASS**, Inspector 1.9.13 discovered all seven exact tools and completed both native audio and bitrate paths in 17.30s. The temporary profile was removed; the real profile was not modified.

The first unpacked-extension attempt failed with `ERR_BLOCKED_BY_CLIENT` for the assumed extension origin. The previously proven disposable-profile route was then used and passed. This failed attempt is not counted as a pass.

Isolated candidate-clone gate:

- Local Git clone plus overlay of the uncommitted candidate worktree, excluding `.git`, `node_modules`, `dist`, and `test-results`.
- `npm ci` — **PASS**, 178 packages, 0 vulnerabilities, 1.10s.
- `npm test` — **PASS**, 124 tests, 2.13s.
- `npm run lint` — **PASS**, 1.42s.
- `npm run build` — **PASS**, 1.24s.

The first sandboxed clone attempt failed because the sandbox denied execution of the installed `esbuild` binary. The first unrestricted clone attempt then found one lint error in the new rehearsal logger; it was fixed before the successful clean rerun above.

Npm warnings retained rather than hidden:

- Installed `eslint@9.33.0` reports that its version is no longer supported.
- The host's npm allow-scripts feature reports `esbuild@0.25.12` as a postinstall script not yet covered by `allowScripts`; installation and the binary validation nevertheless completed.

## Rehearsal timings

Dedicated single-worker deployed run:

- Start click → truthful Healthy: **1.245s**.
- Fault → diagnosis → stage → approval → manual apply → verification → report, cycle 1: **4.454s**.
- Cycle 2: **4.489s**.
- Cycle 3: **4.646s**.
- Complete rehearsal command wall time: **16.88s**.

Full-suite four-worker contention run:

- Start click → truthful Healthy: **2.039s**.
- The same three recovery cycles: **6.330s**, **5.992s**, and **6.084s**.

These are automated interaction completion times, not a claim about narration or external agent latency. The submission script is exactly 2:30 and reserves explicit time for explanation and two user prompts.

## Public deployment evidence

- Repository URL `https://github.com/haitham113/callscope` returned HTTP 200 in a signed-out request.
- Deployment URL `https://haitham113.github.io/callscope/` returned HTTP 200 over HTTPS.
- The deployed HTML referenced the Milestone 6 asset bundle and the complete deployed suite produced **31/31 passes in 1.2 minutes**.
- Those passes cover the judge shell, real audio and bitrate paths, three repeated audio rescues, three repeated bitrate rescues, lifecycle cleanup, negative safety cases, WebMCP audio flow, deliberate approval, responsive layouts, and reduced motion.
- The initial strengthened deployed polish run produced **6/6 passes in 16.3s**, including the complete stacked mobile recovery flow. Review found its contrast selector was too narrow; a corrected all-visible-text audit exposed the active workflow caption at **3.92:1** on the deployed bundle.
- The caption now uses `--text-soft`; the corrected production preview passes **6/6 in 21.1s**, including at least 4.5:1 across visible text in idle, healthy, staged, approved, and recovered workflow states. Deployment revalidation is pending.
- Installed Inspector 1.9.13 discovered the seven exact registered tool names and invoked every tool while completing both deployed audio and bitrate rescues in **17.30s**.
- Three consecutive deployed manual rehearsals passed with no console error or unhandled rejection in **16.88s** total.

Earlier 404s during deployed testing were traced to newer tests navigating to the GitHub Pages domain root with `page.goto('/')`, not to origin flapping. Those tests now use `page.goto('./')`, making them portable to `/callscope/` and localhost.

## Reliability defect found during final rehearsal

One pre-final mixed-load run produced 33 passes, 2 skips, and one truthful `partially_recovered` result: the audio track was restored, but the comparison saw no fresh bidirectional progression. An eight-repeat focused probe initially passed, while a second probe using the 2-second default reproduced the failure once in eight.

Root cause: an owned verification sample could overlap the periodic background sampler and receive the same stats object. The background callback published that object first; verification then reused it as both the previous and current sample, creating a false no-progression delta.

The sampler now supports a `fresh` owned read: it waits for any in-flight published sample and then starts a distinct non-publishing sample. The health and verdict rules remain unchanged. Evidence after the fix:

- Deterministic unit regression: **PASS**; overlapping published and owned reads now use two distinct browser samples.
- Eight-repeat, four-worker WebMCP audio stress run: **8/8 PASS** in 27.1s.
- Original mixed-load full browser suite: **34 PASS / 2 expected skips** in 93.88s.
- No temporary debug logging or relaxed recovery assertion remains.

## Public-repository safety check

- Candidate files scanned: 86.
- Sensitive path types (`.env`, private keys, `.pem`, `.p12`, `.pfx`): none.
- Common AWS/GitHub/OpenAI token and private-key marker matches: none.
- Tracked `node_modules`, `dist`, or `test-results`: none.
- Candidate files over 5 MB: none.
- Root MIT license: present.
- Fresh dependency audit: 0 vulnerabilities.

Synthetic sanitizer fixtures intentionally contain example IP/SDP/secret-shaped data so recursive removal can be tested; the safety scan targets credential-shaped token formats and key files rather than misclassifying those fixtures.

## Documentation and assets

- `README.md` now covers product value, why WebMCP is required, all seven exact tools, approval/application separation, the explicit second prompt, setup, architecture, privacy, browser support, testing, deployment URL, and verified limitations.
- `docs/architecture.md` records implemented boundaries and data flow.
- `LICENSE` is a detectable MIT license and was not changed.
- `docs/screenshots/` contains Healthy, staged recovery, approved-but-still-broken, and before/after recovery images generated from the production preview.
- `docs/submission/` contains the English description, exact 2:30 demo script, public YouTube recording checklist, and submission checklist.

## Remaining actions requiring external authority or access

1. Commit and push the final contrast correction and strengthened validation tests, then rerun the deployed polish gate.
2. Manually complete the two-prompt golden path in ChatGPT's in-app browser.
3. Confirm the repository commit history falls within the challenge period.
4. Record and verify the public YouTube video, then add its URL to the challenge submission.
5. Submit only after explicit user confirmation through the submission workflow.
