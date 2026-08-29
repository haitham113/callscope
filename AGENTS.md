# AGENTS.md

This file contains persistent repository instructions for Codex and other coding agents working on CallScope.

## Instruction Authority

1. `docs/callscope_product_specification.md` is the sole product source of truth.
2. This file defines how agents must work inside the repository.
3. `README.md` explains the project to users and judges; it does not override the specification.
4. Sequential prompt files control task order only; they do not override the specification.

If instructions conflict or the specification is ambiguous, stop and report the conflict before changing product behavior.

## Product Objective

Build CallScope as a polished WebRTC Rescue Room for the OpenAI WebMCP Challenge.

The essential interaction is:

> Observe → Diagnose → Explain → Propose repair → Human approval → Apply → Verify

Optimize decisions for:

- Meaningful WebMCP leverage
- Reliable execution
- Real-world usefulness
- Creativity
- Visible human-agent collaboration
- A clear demonstration that can be completed in under three minutes

## Locked Technical Constraints

- Use Vue 3 with the Composition API.
- Use Vite.
- Use JavaScript, not TypeScript.
- Use Pinia for explicit application state.
- Keep the application static, browser-only, and deployable over HTTPS.
- Use native WebRTC, Web Audio, and Canvas APIs.
- Use generated audio and video for the default experience.
- Do not require camera or microphone permission.
- Do not add accounts, authentication, a database, or backend services.
- Do not add SIP, PBX, Janus, FreeSWITCH, FusionPBX, Mediasoup, or TURN.
- Do not introduce external infrastructure into the challenge MVP.
- Do not add autonomous recovery.

Do not expand the product scope unless the user explicitly approves the change and it clearly strengthens the judging criteria.

## Working Rules

- Read the complete specification before modifying code.
- Inspect the repository and relevant existing files before editing.
- Preserve working behavior and unrelated user changes.
- Work only on the explicitly requested task.
- Do not silently continue into later work.
- Prefer the smallest coherent implementation that satisfies the specification.
- Keep browser-specific logic isolated behind focused services or adapters.
- Reuse the same domain services from both manual UI controls and WebMCP handlers.
- Keep state transitions explicit and reject invalid transitions.
- Keep active-session data in memory and reset it deterministically.
- Treat unavailable browser statistics as unavailable, never as zero.
- Use authoritative track and sender state as primary diagnostic evidence.
- Never implement a fault by changing only a UI or store flag; change the actual browser media state.
- Do not duplicate business logic in Vue components or WebMCP tool handlers.
- Do not leave default scaffold content, dead code, unexplained abstractions, or speculative features.

## WebRTC Requirements

- Use two real in-page `RTCPeerConnection` objects for the loopback call.
- Exchange SDP and ICE candidates in memory.
- Generate video with an animated canvas and `canvas.captureStream()`.
- Generate audio with `AudioContext` and `MediaStreamAudioDestinationNode`.
- Start or resume the audio context from the user's start gesture.
- Display state derived from actual peer connections, tracks, senders, receivers, and `getStats()` reports.
- Calculate rates and deltas using consecutive samples and elapsed time.
- Clean up peer connections, tracks, audio nodes/contexts, event listeners, animation frames, and timers on stop, reset, failure, and teardown.
- Ensure the lab can start, stop, and restart repeatedly without leaking session state.

The required fault scenarios are:

- Disable the actual outbound audio track.
- Constrain the actual video sender bitrate with `RTCRtpSender.setParameters()`.

Do not add nondeterministic ICE, NAT, firewall, or TURN failures to the default demonstration.

## WebMCP Requirements

- Use the imperative `document.modelContext.registerTool()` API.
- Isolate WebMCP compatibility and registration logic in one adapter area.
- Feature-detect WebMCP support.
- Keep tool registrations in the top-level, same-origin document.
- Clean registrations using an `AbortController` tied to the application lifecycle.
- Keep manual controls functional when WebMCP is unavailable.
- Do not enable `document.domain` or serve `Origin-Agent-Cluster: ?0` as a workaround.

Register exactly these seven tools:

1. `get_lab_context`
2. `inspect_call_state`
3. `run_call_diagnostics`
4. `stage_recovery_plan`
5. `apply_recovery_action`
6. `compare_to_failure_baseline`
7. `generate_incident_report`

Tool names, schemas, annotations, validation rules, and outputs must remain consistent with the specification.

Every tool must:

- Delegate to the same services used by the human interface.
- Return a stable, structured, sanitized result or error.
- Reject invalid session, diagnosis, and recovery-plan identifiers.
- Record truthful visible activity in the shared timeline.
- Avoid DOM clicking, DOM scraping, and CSS-selector automation.
- Avoid returning raw application objects.

There must never be a WebMCP tool that approves a recovery.

## Human Approval and Recovery Safety

- The application—not the agent—owns approval state.
- A recovery must be bound to the active session, diagnosis, and fault snapshot.
- A staged recovery expires after 90 seconds or when relevant state changes.
- Only fixed enum-based, allowlisted recovery actions may execute.
- Never evaluate agent-authored text or treat it as executable instructions.
- Revalidate the session, snapshot, action, approval, expiry, and one-time-use status immediately before applying a repair.
- Applying before approval must return `PLAN_NOT_APPROVED` without changing media state.
- Stale, rejected, expired, mismatched, incompatible, and reused plans must fail safely.
- The user must always be able to reject, end, or reset the lab.
- Successful tool invocation alone is not proof of recovery; verify with a fresh stabilized sample and a failure-baseline comparison.

## Privacy and Sanitization

Never expose through the UI, logs, tests, WebMCP outputs, or incident reports:

- Raw local or public IP addresses
- Complete SDP offers or answers
- Device labels
- Credentials, tokens, environment secrets, or private keys
- Recorded or uploaded audio/video

Reduce candidate information to safe categories such as candidate type, protocol, and direct or relayed transport.

Treat agent-authored text as untrusted display content. Do not inject it as HTML or execute it.

## Testing and Validation

- Add focused unit tests for deterministic domain logic.
- Use integration tests for the complete diagnosis and recovery workflow.
- Use a real browser for behavior that depends on WebRTC, Web Audio, Canvas, or WebMCP.
- Do not mock away the browser behavior a test is intended to prove.
- Test successful and negative paths, especially approval bypass, stale plans, expiry, reuse, session mismatch, cleanup, and restart.
- Test WebMCP-disabled behavior.
- Test sanitization recursively, including nested errors and report data.
- Test the production build and preview, not only the development server.
- Keep the hero demo deterministic and rehearse it repeatedly.

For WebMCP validation, use the user's WebMCP-enabled Chrome plugin/extension manually when available. Record exact tool inputs, structured outputs, and visible UI effects. Do not require an AI agent or paid API account for these checks.

Never claim that a command, test, browser flow, or WebMCP flow passed unless it was actually run. If an environment prevents validation, mark the result `NOT VERIFIED` and provide the shortest exact manual test procedure.

## Completion Report

After any meaningful implementation or fix, report:

- Files changed
- Important decisions
- Commands actually run
- Actual results
- Unverified behavior
- Remaining limitations or risks
- Documentation updated
- Suggested Conventional Commit message

Do not hide warnings or convert unverified behavior into a pass.

## Documentation Rules

- Keep `README.md` focused on the project, its value, usage, architecture, tools, privacy, and testing.
- Do not add implementation phases, internal execution prompts, or development planning to `README.md`.
- Keep tool names and behavioral claims synchronized across code, tests, README, and the specification.
- Update setup and validation commands when the repository scripts change.
- Do not add fake benchmarks, production claims, compliance claims, screenshots, URLs, or test results.

## Git and Repository Safety

- Preserve unrelated user changes in a dirty worktree.
- Do not use destructive Git commands.
- Do not commit, push, publish, deploy, or submit unless the user explicitly asks.
- Never expose secret values when reporting a repository-safety finding.
- Keep example and seed data obviously synthetic.

## Definition of Working

A feature is working only when its required behavior has been implemented and validated with actual evidence.

For the core experience, that means a user can start a generated WebRTC call, introduce a real fault, obtain an evidence-backed diagnosis, review and approve a compatible repair, apply it to the actual media state, verify measurable recovery, and generate a sanitized incident report—with every action visible and without external infrastructure or credentials.
