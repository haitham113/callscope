# Milestone 6 validation record

Date: 2026-09-01
Scope: production reliability, judge-facing polish, synchronized documentation, and submission readiness only

## Gate summary

| Environment | Result | Evidence |
| --- | --- | --- |
| Local production preview in Chrome | **PASS** | Full manual and WebMCP audio/video flows, negative paths, responsive/accessibility checks, screenshots, repeated rehearsals, and console/unhandled-error assertions passed. |
| Installed WebMCP Inspector 1.9.13 against production preview | **PASS** | Native extension-message bitrate rescue passed in a disposable Chrome profile in 51.3s. |
| Isolated candidate clone with fresh dependencies | **PASS** | `npm ci`, 124 tests, lint, and production build passed; npm reported 0 vulnerabilities. |
| Public repository | **PASS; M6 PUSH PENDING** | Signed-out HTTPS request returned 200; candidate scan found no secret-like paths/patterns, tracked generated directories, or files over 5 MB. Milestone 6 is present in this revision but is not yet published to the remote repository. |
| Current public deployment | **MILESTONE 5 PASS; MILESTONE 6 NOT DEPLOYED** | Core, audio, bitrate, native WebMCP, and tablet checks passed. Four new M6-only assertions fail because the public bundle lacks the workflow strip, deliberate approval copy, visible mobile readiness badge, and updated reduced-motion rule. |
| ChatGPT in-app browser | **NOT VERIFIED** | This supported client is unavailable from the current environment. |
| Public YouTube recording and challenge submission | **NOT COMPLETED** | Checklists and exact script exist; no recording was fabricated or uploaded and nothing was submitted. |

Milestone 6 is locally implemented and verified, but the specification's deployed judge-readiness exit condition is **not yet a pass**. Publishing, deployment verification, recording, and submission still require their corresponding external steps.

## Judge-facing polish verified locally

- Operations-console hierarchy includes a five-step Observe → Diagnose → Approve → Recover → Verify strip.
- Health state is the dominant status element, uses polite live announcements, and changes with restrained 180ms transitions.
- Timeline actor badges visibly distinguish User, Agent, and System; Agent tool titles render as exact monospace tool names.
- The staged plan explains that approval records consent only and keeps the real media fault unchanged.
- The approved state says the media is still broken, displays the exact continuation prompt, and places **Apply manually** behind a visibly secondary “No agent available?” fallback.
- Unsupported WebMCP state remains visible and explains that the full manual rescue needs no credentials or extension.
- Loading, empty, error, ended/reset, and cleanup states have explicit judge-facing copy.
- A skip link, keyboard activation, visible focus, improved text contrast, polite status announcements, and reduced-motion behavior are covered.
- 820×1180 tablet and 390×844 stacked mobile checks pass without horizontal overflow; the WebMCP readiness badge remains visible.
- Console errors and uncaught page errors are collected and required to remain empty in polish, screenshot, rehearsal, and golden-path browser tests.

## Commands and actual results

Final working-tree gates:

- `npm test` — **PASS**, 23 files / 124 tests, 2.78s wall time.
- `npm run lint` — **PASS**, no errors or warnings, 2.67s wall time.
- `npm run build` — **PASS**, 40 modules; 0.90 kB HTML, 25.68 kB CSS, 183.94 kB JS before gzip; 2.77s wall time.
- `npm run test:browser` — **PASS**, 34 passed / 2 expected skips, 93.88s wall time. The skips were native WebMCP discovery in an ordinary Chrome profile and the opt-in installed-extension test.
- `npm run test:spikes` — **PASS**, generated media/repeated negotiation/sender readback passed; native WebMCP discovery skipped in the ordinary profile; 5.33s wall time.
- `npm run capture:screenshots` — **PASS**, four real-browser submission states, final run 9.2s.
- `CALLSCOPE_WEBMCP_USER_DATA_DIR=<disposable-profile> npm run test:plugin` — **PASS**, Inspector 1.9.13 native bitrate path, 51.3s. The temporary profile was removed; the real profile was not modified.

The first unpacked-extension attempt failed with `ERR_BLOCKED_BY_CLIENT` for the assumed extension origin. The previously proven disposable-profile route was then used and passed. This failed attempt is not counted as a pass.

Isolated candidate-clone gate:

- Local Git clone plus overlay of the uncommitted candidate worktree, excluding `.git`, `node_modules`, `dist`, and `test-results`.
- `npm ci` — **PASS**, 178 packages, 0 vulnerabilities, 1.00s.
- `npm test` — **PASS**, 124 tests, 1.87s.
- `npm run lint` — **PASS**, 1.11s.
- `npm run build` — **PASS**, 1.13s.

The first sandboxed clone attempt failed because the sandbox denied execution of the installed `esbuild` binary. The first unrestricted clone attempt then found one lint error in the new rehearsal logger; it was fixed before the successful clean rerun above.

Npm warnings retained rather than hidden:

- Installed `eslint@9.33.0` reports that its version is no longer supported.
- The host's npm allow-scripts feature reports `esbuild@0.25.12` as a postinstall script not yet covered by `allowScripts`; installation and the binary validation nevertheless completed.

## Rehearsal timings

Dedicated single-worker production-preview run:

- Start click → truthful Healthy: **1.719s**.
- Fault → diagnosis → stage → approval → manual apply → verification → report, cycle 1: **4.398s**.
- Cycle 2: **4.557s**.
- Cycle 3: **4.554s**.

Full-suite four-worker contention run:

- Start click → truthful Healthy: **2.053s**.
- The same three recovery cycles: **6.855s**, **6.434s**, and **6.797s**.

These are automated interaction completion times, not a claim about narration or external agent latency. The submission script is exactly 2:30 and reserves explicit time for explanation and two user prompts.

## Public deployment evidence

- Repository URL `https://github.com/haitham113/callscope` returned HTTP 200 in a signed-out request.
- Deployment URL `https://haitham113.github.io/callscope/` returned HTTP 200 over HTTPS.
- Installed Inspector 1.9.13 completed the deployed bitrate rescue through native WebMCP in 31.3s.
- After correcting the Playwright specs from root-absolute `/` navigation to base-path-relative `./`, the deployed suite produced **27 passes and 4 M6-only failures in 1.4 minutes**.
- The 27 passes cover the judge shell, real audio and bitrate paths, three repeated audio rescues, three repeated bitrate rescues, lifecycle cleanup, negative safety cases, WebMCP audio flow, and tablet layout.
- The four expected failures precisely show that Milestone 6 is not published: missing workflow strip/fallback callout, old approval copy, hidden mobile readiness badge, and the old reduced-motion duration.

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

- Candidate files scanned: 83.
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

1. Push this Milestone 6 revision, allowing the existing GitHub Pages workflow to deploy it.
2. Rerun the 31-test deployed suite and require 31/31.
3. Repeat both native Inspector audio/bitrate paths on the deployed Milestone 6 bundle.
4. Manually complete the two-prompt golden path in ChatGPT's in-app browser.
5. Record and verify the public YouTube video, then complete the external submission checklist.
6. Submit only after explicit user confirmation through the submission workflow.
