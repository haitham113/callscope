# Milestone 5 validation record

Date: 2026-09-01

Scope: constrained-video-bitrate fault, observability completion, and audio-path regression

## Gate summary

| Environment | Result | Evidence |
| --- | --- | --- |
| Local production preview in Chrome | **PASS** | Real sender cap/readback/restoration, manual and WebMCP recovery, reset/switching, three repeated bitrate flows, and all prior audio/safety/lifecycle browser tests passed. |
| Installed WebMCP Inspector 1.9.13 | **PASS** | A headed Chrome run invoked the bitrate workflow through the extension `EXECUTE_TOOL` message channel with native `document.modelContext`. |
| Existing public deployment | **MILESTONE 5 NOT DEPLOYED** | The public audio/lifecycle suite passed 13/13, but its published bundle predates the Milestone 5 UI and sender implementation. No deployment was performed because it was not authorized. |
| ChatGPT in-app browser | **NOT VERIFIED** | The supported client was unavailable in this environment. |

## Verified bitrate behavior

- The video sender's complete negotiated encoding profile is cloned before fault mutation.
- `RTCRtpSender.setParameters()` applies an 80,000 bps cap to every active video encoding.
- Fresh `getParameters()` readback confirms the cap immediately.
- Health becomes **Degraded** from the confirmed sender configuration, not from measured bitrate or frame behavior.
- Diagnosis returns `VIDEO_SENDER_BITRATE_CONSTRAINED` and allows only `restore_video_bitrate`.
- Pre-approval application returns `PLAN_NOT_APPROVED` without changing sender state.
- Human approval changes application state only.
- Manual and WebMCP application restore the preserved encoding profile and immediately compare fresh readback with it.
- Verification requires cap removal, preserved-profile match, sender attachment, and connected peers.
- Measured bitrate and frame rate remain supporting evidence only and may be unavailable or unchanged.
- Audio and video faults cannot be switched without **Reset scenario to healthy**.
- Selected ICE evidence contains only candidate type, protocol, and direct/relayed classification.

## Commands and actual results

- `npm test` — **PASS**, 23 files and 120 tests.
- `npm run lint` — **PASS**, no warnings or errors.
- `npm run build` — **PASS**, 40 modules transformed.
- `npm run test:e2e` — **PASS**, 26 production-preview browser tests.
- `npm run test:spikes` — **PASS**, repeated real sender-parameter spike passed; native WebMCP discovery skipped in the ordinary headless profile.
- `CALLSCOPE_WEBMCP_USER_DATA_DIR=<temporary-profile> npm run test:plugin` — **PASS**, one native Inspector extension-message bitrate flow.
- `CALLSCOPE_BASE_URL=https://haitham113.github.io/callscope/ npx playwright test tests/browser/lab-lifecycle.spec.js tests/browser/manual-audio-rescue.spec.js tests/browser/webmcp-audio-rescue.spec.js` — **PASS**, 13 deployed audio/lifecycle tests including three repeated audio rescues.

The native Inspector test used a temporary copy of only the installed extension and minimal Chrome profile metadata. The real Chrome profile was not modified, and the temporary copy was deleted after the run.

## Remaining limitations

- The public deployment does not contain Milestone 5; deployed bitrate behavior is therefore **NOT VERIFIED**.
- ChatGPT's in-app browser was unavailable and remains **NOT VERIFIED**.
- Packet loss, RTT, jitter, measured bitrate, and frame rate vary by browser and sample window. Their unavailable states are displayed honestly and do not independently change health.
- Visible video-quality degradation is browser-dependent and is not required or claimed.
