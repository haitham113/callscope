# CallScope architecture

CallScope is a static Vue 3 application. The active incident exists only in browser memory; there is no account, backend, database, uploaded media, or external call infrastructure.

## Runtime flow

```text
Human controls ─┐
                ├─> capability-scoped lab controller ─> shared domain services
WebMCP adapter ─┘                                      ├─> WebRTC loopback
                                                      ├─> Web Audio + Canvas media
                                                      ├─> stats + health engine
                                                      └─> Pinia state + visible timeline
```

The human controller owns start, end, faults, approval, rejection, and the manual fallback. The agent controller owns inspection, diagnostics, plan staging, approved-plan execution, comparison, and reporting. The agent controller is never given `approvePlan()` or `rejectPlan()`.

## Major modules

| Area | Responsibility |
| --- | --- |
| `src/features/lab/services/demoMediaService.js` | Generates canvas video and Web Audio tracks; tears down tracks, nodes, context, and animation. |
| `src/features/lab/services/loopbackPeerService.js` | Connects two in-page `RTCPeerConnection` objects, exchanges SDP/ICE in memory, and exposes authoritative sender/receiver state. |
| `src/features/lab/services/labController.js` | Composes shared domain operations and exposes separate human and agent capabilities. |
| `src/features/lab/stores/labStore.js` | Holds explicit active-session, fault, evidence, recovery, timeline, report, and cleanup state. |
| `src/features/diagnostics/services/*` | Samples real stats, hashes snapshots, scores explainable health, ranks known faults, and recursively sanitizes results. |
| `src/features/recovery/services/*` | Binds plans to session/epoch/fault/snapshot, enforces approval and expiry, dispatches allowlisted actions, and verifies fresh evidence. |
| `src/features/webmcp/*` | Defines the exact seven schemas, validates inputs, maps handlers to the agent controller, and registers through `document.modelContext.registerTool()`. |
| `src/features/reports/services/reportService.js` | Creates stable sanitized summaries and Markdown without persisting incident data. |
| `src/app/App.vue` | Renders the operations console, workflow state, timeline, human approval, comparison, report, and fallback UI. |

## State and ownership

Every session has a UUID and monotonic epoch. Fault changes increment a fault revision. Diagnoses and plans are bound to those values and a deterministic snapshot hash. Reset or end aborts in-flight work and invalidates ownership before a late result can update the UI.

The visible flow is:

```text
idle → starting → healthy → critical/degraded → diagnosing
     → awaiting approval → recovering → verifying → healthy
     → ended/failed
```

Approval is a separate application-owned transition. It never changes media. Immediately before applying a repair, the executor revalidates the session, epoch, fault revision, snapshot, plan status, expiry, action compatibility, and one-time-use state.

## Real media and evidence

The default experience creates generated audio and video after the Start gesture. The tracks are sent across two real local peer connections. Health becomes Healthy only after connected peers, live attached tracks, and progressing real media counters are observed across samples.

The audio fault sets the actual outbound track's `enabled` property to `false`. The video fault calls `RTCRtpSender.setParameters()` with an 80,000 bps cap. Track and sender readback are primary evidence; browser-dependent energy, bitrate, frame rate, loss, jitter, and RTT are supporting evidence and may be unavailable.

## WebMCP boundary

The top-level same-origin page registers exactly seven imperative tools. One `AbortController` owns their lifecycle. Handlers validate schemas, delegate to shared services, return stable sanitized data, and record the exact tool name with actor `Agent` in the visible timeline. They do not click or scrape the DOM.

There is intentionally no approval tool. After approval, the page tells the user to send a second prompt so the agent can call `apply_recovery_action`, `compare_to_failure_baseline`, and `generate_incident_report`.

## Privacy and cleanup

Sanitization recursively removes raw IP addresses, SDP, device labels, credentials, tokens, secrets, and private keys. Candidate evidence is reduced to type, protocol, and direct/relayed path. Generated media is not recorded or uploaded.

End/reset produces a cleanup receipt from authoritative resource references: peers closed, generated and remote tracks ended, AudioContext closed, animation stopped, audio nodes disconnected, sampler inactive, ICE work drained, listeners removed, and timers stopped.

## Deployment

Vite builds static assets with a configurable base path. GitHub Actions runs `npm ci`, unit/integration tests, and the production build before publishing `dist/` to GitHub Pages. The configured public URL is <https://haitham113.github.io/callscope/>. Deployment status must be verified separately from local build status.
