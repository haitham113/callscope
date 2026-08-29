# CallScope — Build-Ready Product Specification

**Working subtitle:** The WebRTC Rescue Room  
**Challenge:** OpenAI WebMCP Challenge 2026  
**Submission deadline:** September 3, 2026, 1:00 p.m. PDT / 11:00 p.m. Cairo time  
**Document status:** MVP scope locked for implementation  

## 1. Executive Summary

CallScope is a browser-based WebRTC diagnostics laboratory where a person and an AI agent inspect and recover a live call together.

The user starts a deterministic in-browser WebRTC session, introduces a real media fault, and asks the browser agent to diagnose it. The agent uses WebMCP tools exposed by CallScope to read the active `RTCPeerConnection`, media-track, and health state. It explains the fault inside the shared interface, stages a recovery plan, asks for approval, applies an allowlisted repair, and verifies the result with before-and-after evidence.

CallScope is not a passive monitoring dashboard and not a post-call log analyzer. Its central interaction is:

> **Observe the live problem → explain it → obtain human approval → repair it → prove recovery.**

The core experience runs fully in the browser and does not require a PBX, Janus, a backend API, authentication, uploaded logs, or access to real customer calls.

## 2. Product Promise

### One-sentence pitch

CallScope lets a support engineer ask an agent why a browser call is failing, safely approve a suggested repair, and watch the call recover in the same interface.

### Target audience

Primary:

- WebRTC developers.
- Technical support and quality-assurance engineers.
- Engineers responsible for browser voice/video reliability.

Secondary:

- Developers learning WebRTC diagnostics.
- Teams evaluating human-in-the-loop browser agents.

### Core problem

WebRTC failures are difficult to diagnose because useful evidence is distributed across media tracks, peer-connection state, ICE state, sender parameters, and continuously changing statistics. Humans often inspect low-level browser output and manually correlate symptoms with possible causes.

CallScope exposes the relevant live state as purpose-built WebMCP tools, allowing an agent to reason over structured evidence while the user remains in control of any change.

## 3. Why WebMCP Is Essential

CallScope depends on client-side state that exists only while the page and its peer connection are active:

- Current media tracks and their `readyState`, `enabled`, and direction.
- Live `RTCPeerConnection` and ICE states.
- Selected candidate-pair characteristics without exposing raw addresses.
- Current sender parameters, including bitrate constraints.
- Live counters and calculated deltas from `getStats()`.
- The currently active fault, baseline, recovery plan, and UI state.

A backend MCP integration would need duplicated session state, separate authentication, and a transport for continuously changing browser metrics. WebMCP allows the agent to use the page's existing JavaScript logic and update the same interface the human is viewing.

## 4. Challenge Strategy

CallScope is designed around the four equally weighted judging dimensions.

| Criterion | Evidence in the MVP |
| --- | --- |
| WebMCP leverage | Seven structured tools operate on live browser state; tools include reads, staged writes, a confirmed recovery action, verification, and report generation. |
| Execution | Deterministic demo, coherent visual state, manual fallback controls, explicit errors, responsive layout, and no fragile external infrastructure. |
| Potential impact | A specific solution for WebRTC developers and support teams facing real diagnostic complexity. |
| Creativity and ambition | The agent does not merely summarize data; it collaborates with a human to recover a running browser call and verify the outcome. |

## 5. MVP Goals and Non-Goals

### Goals

1. Start a real, self-contained WebRTC loopback session in one click.
2. Produce live measurements from the browser's actual WebRTC APIs.
3. Introduce at least two deterministic, real media faults.
4. Let an agent diagnose the active fault using WebMCP tools.
5. Stage the proposed repair visibly in the application.
6. Require explicit approval before changing the live media session.
7. Apply a recovery through an allowlisted action.
8. Verify recovery by comparing the current state with the failure baseline.
9. Generate a sanitized incident report.
10. Work without an OpenAI API key, user account, server database, PBX, or uploaded file.

### Non-goals for the challenge MVP

- SIP registration or direct raw-SIP browser connectivity.
- Janus Gateway, FreeSWITCH, FusionPBX, Mediasoup, or TURN deployment.
- Multi-party calls or multi-call handling.
- Production monitoring across customer sessions.
- Uploading or parsing `webrtc-internals` dumps.
- Automatic modification of arbitrary third-party websites.
- Full SDP display, raw ICE addresses, authentication credentials, or secrets.
- Autonomous repairs without user approval.
- AI-generated diagnoses inside CallScope itself; the browser agent performs the reasoning.
- Authentication, billing, organizations, dashboards, or persistent accounts.
- Mobile-native packaging.

These features may appear in a roadmap, but they must not delay the contest submission.

## 6. The Golden User Story

> As a WebRTC support engineer, I want to ask an agent why the active browser call has failed, review the evidence and proposed repair in CallScope, approve the change, and verify that media health improved without manually interpreting raw WebRTC statistics.

### Golden demo flow

1. The user opens CallScope and selects **Demo Lab**.
2. The user clicks **Start healthy call**.
3. CallScope creates generated audio/video tracks and connects two in-page `RTCPeerConnection` objects.
4. The health indicator becomes **Healthy**, and CallScope stores a healthy baseline.
5. The user clicks **Break audio track**.
6. The sender's actual audio track is disabled; live state and statistics update.
7. The user asks the browser agent: **“Why is this call silent? Diagnose it and propose the safest repair.”**
8. The agent calls `get_lab_context`, `inspect_call_state`, and `run_call_diagnostics`.
9. The agent calls `stage_recovery_plan`; CallScope displays the evidence, proposed action, expected effect, and risk.
10. The user explicitly approves the plan.
11. The agent calls `apply_recovery_action` with the issued plan ID.
12. CallScope re-enables the track and records a post-repair snapshot.
13. The agent calls `compare_to_failure_baseline`.
14. The UI changes from **Critical** to **Healthy** and displays the measured improvement.
15. The agent calls `generate_incident_report` and CallScope displays a sanitized summary.

## 7. Demo Media and Fault Injection

### Deterministic media sources

To avoid camera/microphone permission failures during judging:

- Generate video with a `<canvas>` animation and `canvas.captureStream(30)`.
- Generate audio with `AudioContext`, an oscillator or patterned tone, and `MediaStreamAudioDestinationNode`.
- Send both tracks through two connected in-page peer connections.
- Render the received video and an audio-level visualization.

This produces a real `RTCPeerConnection`, real senders/receivers, and real `getStats()` reports while remaining deterministic.

### MVP fault scenarios

#### Fault A — Audio track disabled

- Trigger: Set the active outbound audio track's `enabled` value to `false`.
- Observable evidence: Track exists and is live but disabled; outbound audio energy stops increasing; outbound audio packets may stop or carry silence depending on browser behavior.
- Allowed recovery: Set `enabled` to `true`.
- Demo value: Extremely reliable and immediately understandable.

#### Fault B — Video bitrate constrained

- Trigger: Use `RTCRtpSender.setParameters()` to set an intentionally low `maxBitrate` on the video encoding.
- Observable evidence: Active cap in sender parameters, reduced outbound bitrate, and potentially reduced visual quality/frame throughput.
- Allowed recovery: Restore the normal demo bitrate profile.
- Demo value: Shows quantitative before-and-after verification.

### Optional fault only after the core is stable

#### Fault C — Sender track detached

- Trigger: Call `replaceTrack(null)` on the audio or video sender while retaining the generated source.
- Observable evidence: Sender has no active track; receiver stops receiving the relevant media.
- Allowed recovery: Restore the known generated source with `replaceTrack(originalTrack)`.

Do not implement nondeterministic ICE, NAT, firewall, or TURN failures for the MVP. Those are credible future scenarios but risky for a three-minute judged demo.

## 8. Application Screens

CallScope is a single-page application with four primary visual regions and two secondary views.

### 8.1 Welcome / Lab Setup

Purpose: Explain the promise and start the deterministic experience quickly.

Required elements:

- CallScope name and one-sentence value proposition.
- **Start Demo Lab** primary action.
- Short privacy statement: generated media, no recording, no raw IP display.
- Browser/WebMCP readiness badges.
- Compact “How the demo works” explanation.

Acceptance rule: A judge must reach a healthy call with one primary click after page load.

### 8.2 Live Call Workspace

Purpose: Display the media session, health, fault controls, and collaboration state.

Required areas:

- Remote video panel with generated animation.
- Call status and elapsed time.
- Large health badge: `Starting`, `Healthy`, `Degraded`, `Critical`, `Recovering`, or `Ended`.
- Audio energy meter.
- Four key metrics: outbound bitrate, packet loss, jitter/RTT when available, and frame rate.
- Track status chips for audio and video.
- ICE/connection state chips.
- Demo fault controls clearly labeled as simulation controls.
- A visible prompt suggestion for the user to send to the agent.

### 8.3 Diagnosis Timeline

Purpose: Make agent actions and evidence visible rather than hiding the workflow in chat.

Timeline event types:

- Snapshot captured.
- Fault introduced.
- Inspection performed.
- Diagnosis completed.
- Recovery plan staged.
- Human approval recorded.
- Recovery applied.
- Verification completed.
- Report generated.

Each event includes actor (`User`, `Agent`, or `System`), time, concise description, and expandable sanitized evidence.

### 8.4 Recovery Plan Drawer

Purpose: Support informed human approval.

Required fields:

- Diagnosis summary.
- Evidence list.
- Proposed action.
- Expected result.
- Risk level: `low`, `medium`, or `high`.
- Whether the action is reversible.
- **Approve and apply** and **Reject** controls.
- Expiration notice for stale plans.

The drawer must be visible when `stage_recovery_plan` succeeds. An action cannot be applied until the plan is approved.

### 8.5 Before / After Comparison

Purpose: Prove recovery rather than merely claim it.

Required fields:

- Failure snapshot and current snapshot.
- Health-score delta.
- Track-state changes.
- Bitrate/energy changes relevant to the diagnosed fault.
- Connection-state changes.
- Verdict: `recovered`, `partially_recovered`, or `not_recovered`.

### 8.6 Incident Report

Purpose: Summarize what happened in a readable, shareable format.

Required sections:

- Session ID and timestamps.
- User-visible symptom.
- Root cause.
- Sanitized evidence.
- Approved recovery.
- Verification result.
- Remaining recommendations.

The MVP may render the report in the page and allow Markdown download. PDF is optional and must not block submission.

## 9. State Model

### 9.1 Lab session state

Use an explicit state machine rather than loosely related booleans.

```text
idle
  -> starting
  -> healthy
  -> degraded | critical
  -> diagnosing
  -> awaiting_approval
  -> recovering
  -> verifying
  -> healthy | degraded | critical
  -> ended | failed
```

Rules:

- Only one demo session is active in the MVP.
- Every session has a generated UUID.
- State transitions are recorded in the diagnosis timeline.
- Invalid transitions return structured errors and do not silently change state.
- A user can always end and restart the lab.

### 9.2 Recovery plan state

```text
draft -> staged -> approved | rejected | expired -> applied -> verified
```

Rules:

- Each plan has a unique ID and is bound to the current session and fault snapshot.
- Plans expire after 90 seconds or when the session/fault changes.
- `apply_recovery_action` accepts only an approved, unexpired plan ID.
- A plan can invoke only an allowlisted action compatible with the detected fault.
- Applying a stale, mismatched, or previously used plan returns an explicit error.

## 10. Health Model

The health model is deterministic and explainable. It must not pretend to provide production-grade MOS accuracy.

### Inputs

- Peer connection state.
- ICE connection state.
- Audio/video track existence, `enabled`, and `readyState`.
- Sender-track attachment.
- Outbound/inbound packet deltas.
- Audio energy deltas where exposed.
- Outbound bitrate calculated from byte deltas.
- Video frames-per-second or frame deltas.
- Sender bitrate constraints.
- Packet loss, jitter, and RTT when meaningful values are available.

### Status rules

- **Critical:** Connection failed/closed unexpectedly, required track missing/ended/detached, or active audio fault detected.
- **Degraded:** Connection is active but a configured bitrate cap or material performance reduction is detected.
- **Healthy:** Connection is active, required tracks are live/enabled/attached, and expected demo media counters are progressing.
- **Recovering:** An approved repair is being executed and stabilization samples are pending.

### Score

Display an explainable 0–100 lab-health score using rule-based deductions. Every deduction must be visible in the diagnosis output. Avoid false precision in the report; the categorical status is more important than the numeric score.

## 11. WebMCP Tool Set

All tools must:

- Use `document.modelContext.registerTool()`.
- Have concise, explicit descriptions and JSON Schema input definitions.
- Reuse the same application services used by manual UI controls.
- Return structured, sanitized results.
- Update the shared UI timeline so the user can see what the agent did.
- Reject invalid session IDs, stale plan IDs, and unsupported actions.
- Never return raw IP addresses, full SDP, credentials, device labels, or secrets.
- Be registered and cleaned up with an `AbortController` tied to the Vue component/application lifecycle.

### 11.1 `get_lab_context`

**Type:** Read-only  
**Purpose:** Give the agent a compact overview before it selects deeper tools.

Input:

```json
{
  "type": "object",
  "properties": {}
}
```

Output fields:

- `session_id`
- `lab_state`
- `health_status`
- `active_fault`
- `pending_plan_id`
- `webmcp_supported`
- `suggested_next_tools`

Annotations: `readOnlyHint: true`.

### 11.2 `inspect_call_state`

**Type:** Read-only  
**Purpose:** Return a sanitized snapshot of current peer, ICE, media-track, sender, receiver, and fault state.

Input:

```json
{
  "type": "object",
  "properties": {
    "session_id": { "type": "string" },
    "detail": {
      "type": "string",
      "enum": ["summary", "media", "connection", "all"]
    }
  },
  "required": ["session_id"]
}
```

Output fields:

- Connection and ICE states.
- Sanitized selected candidate type/protocol/relay status.
- Audio/video track status.
- Sender attachment and bitrate limits.
- Current health status and deductions.
- Snapshot timestamp.

Annotations: `readOnlyHint: true`.

### 11.3 `run_call_diagnostics`

**Type:** Read-only analysis  
**Purpose:** Sample live statistics over a short window, correlate symptoms, and return ranked rule-based findings.

Input:

```json
{
  "type": "object",
  "properties": {
    "session_id": { "type": "string" },
    "symptom": {
      "type": "string",
      "enum": ["silent_audio", "poor_video", "connection_problem", "unknown"]
    },
    "sample_duration_ms": {
      "type": "integer",
      "minimum": 1000,
      "maximum": 5000,
      "default": 2000
    }
  },
  "required": ["session_id", "symptom"]
}
```

Output fields:

- `diagnosis_id`
- Ranked findings with severity, evidence, confidence label, and allowed recovery actions.
- Metrics at start and end of the sample window.
- Explicit limitations or unavailable metrics.

Annotations: `readOnlyHint: true`.

### 11.4 `stage_recovery_plan`

**Type:** Non-destructive write  
**Purpose:** Display an agent-proposed plan in CallScope for human review.

Input:

```json
{
  "type": "object",
  "properties": {
    "session_id": { "type": "string" },
    "diagnosis_id": { "type": "string" },
    "action": {
      "type": "string",
      "enum": ["enable_audio_track", "restore_video_bitrate", "reattach_generated_track"]
    },
    "reason": { "type": "string", "maxLength": 500 },
    "expected_result": { "type": "string", "maxLength": 300 }
  },
  "required": ["session_id", "diagnosis_id", "action", "reason", "expected_result"]
}
```

Validation:

- The action must be allowed by the referenced diagnosis.
- The diagnosis and current fault snapshot must match.
- Free-text fields are displayed as untrusted agent-authored content and never interpreted as commands.

Output fields:

- `plan_id`
- `status: staged`
- Risk and reversibility metadata.
- Expiration timestamp.
- Message that explicit user approval is required.

Annotations: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`.

### 11.5 `apply_recovery_action`

**Type:** Confirmed write  
**Purpose:** Apply exactly one previously staged and user-approved allowlisted repair.

Input:

```json
{
  "type": "object",
  "properties": {
    "session_id": { "type": "string" },
    "plan_id": { "type": "string" }
  },
  "required": ["session_id", "plan_id"]
}
```

Validation:

- The plan must be approved in the UI.
- The plan must be unexpired, unused, and bound to the active session.
- The active state must still match the diagnosis snapshot.
- The executor dispatches only a fixed internal action; it never executes agent-provided code or arbitrary parameters.

Output fields:

- Applied action.
- Previous and new state.
- Stabilization wait time.
- Next recommended tool: `compare_to_failure_baseline`.

Annotations: `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`.

### 11.6 `compare_to_failure_baseline`

**Type:** Read-only verification  
**Purpose:** Compare the latest stabilized sample with the stored failure snapshot.

Input:

```json
{
  "type": "object",
  "properties": {
    "session_id": { "type": "string" },
    "plan_id": { "type": "string" },
    "sample_duration_ms": {
      "type": "integer",
      "minimum": 1000,
      "maximum": 5000,
      "default": 2000
    }
  },
  "required": ["session_id", "plan_id"]
}
```

Output fields:

- Before and after status/score.
- Relevant metric deltas.
- Restored track/parameter states.
- Verdict: `recovered`, `partially_recovered`, or `not_recovered`.
- Remaining findings.

Annotations: `readOnlyHint: true`.

### 11.7 `generate_incident_report`

**Type:** Non-destructive write  
**Purpose:** Build and display a sanitized report from the session timeline and verified evidence.

Input:

```json
{
  "type": "object",
  "properties": {
    "session_id": { "type": "string" },
    "format": {
      "type": "string",
      "enum": ["summary", "markdown"],
      "default": "summary"
    }
  },
  "required": ["session_id"]
}
```

Output fields:

- Report ID.
- Structured report sections.
- Sanitization summary.
- Download availability.

Annotations: `readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true` for an unchanged timeline.

## 12. Manual UI Parity

Every meaningful WebMCP action must use application logic that is also available to the human interface:

| Capability | Human UI | WebMCP |
| --- | --- | --- |
| Start/end demo call | Yes | No tool required for golden path |
| Inspect current health | Yes | `get_lab_context`, `inspect_call_state` |
| Run diagnostics | Yes | `run_call_diagnostics` |
| Stage plan | Agent collaboration panel | `stage_recovery_plan` |
| Approve/reject plan | Yes, human only | No agent approval tool |
| Apply approved repair | Yes | `apply_recovery_action` |
| Verify recovery | Yes | `compare_to_failure_baseline` |
| Generate report | Yes | `generate_incident_report` |

The agent must never possess a tool that approves its own plan.

## 13. Technical Architecture

### 13.1 Technology choices

- Vue 3 Composition API.
- Vite.
- JavaScript, not TypeScript.
- Pinia for explicit application state.
- Tailwind CSS or a small token-based CSS layer.
- Native WebRTC APIs.
- Native Web Audio and Canvas APIs.
- Native `document.modelContext.registerTool()` WebMCP API.
- Static HTTPS deployment.
- Vitest for unit tests.
- Playwright for browser flows where WebMCP can be stubbed or inspected.

No backend is required for the challenge MVP.

### 13.2 Feature-oriented structure

```text
src/
  app/
    App.vue
    router.js
  features/
    lab/
      components/
      stores/labStore.js
      services/demoMediaService.js
      services/loopbackPeerService.js
      services/faultService.js
      labMachine.js
    diagnostics/
      components/
      stores/diagnosticsStore.js
      services/statsSampler.js
      services/healthEngine.js
      services/diagnosticRules.js
      services/sanitizer.js
    recovery/
      components/
      stores/recoveryStore.js
      services/recoveryPlanService.js
      services/recoveryExecutor.js
    reports/
      components/
      services/reportService.js
    webmcp/
      WebMcpProvider.vue
      toolRegistry.js
      toolSchemas.js
      toolResult.js
  shared/
    components/
    constants/
    utils/
```

### 13.3 Service responsibilities

#### `demoMediaService`

- Create and destroy generated audio/video sources.
- Retain original tracks for safe reattachment.
- Expose sanitized track status.

#### `loopbackPeerService`

- Create two peer connections.
- Exchange SDP and ICE candidates in memory.
- Attach generated tracks.
- Expose connection state and senders/receivers.
- Stop and clean all resources deterministically.

#### `statsSampler`

- Call `getStats()` at controlled intervals.
- Normalize browser reports into a small internal model.
- Calculate deltas and rates from consecutive samples.
- Distinguish unavailable from zero-valued metrics.

#### `healthEngine`

- Produce deterministic status, score, and visible deductions.
- Never use hidden or unexplained scoring.

#### `diagnosticRules`

- Match sanitized evidence to known fault patterns.
- Rank findings.
- Return only compatible recovery actions.

#### `recoveryPlanService`

- Bind plans to session, diagnosis, and snapshot hashes.
- Track approval, rejection, expiry, application, and verification.

#### `recoveryExecutor`

- Dispatch fixed allowlisted actions.
- Revalidate state immediately before applying a change.
- Record previous/new state and timeline events.

#### `sanitizer`

- Remove raw IP addresses, SDP, device labels, and secrets.
- Convert candidate data to safe categories such as `host`, `srflx`, `relay`, UDP/TCP, and direct/relayed.

### 13.4 WebMCP readiness

- Serve the application over HTTPS.
- Feature-detect `document.modelContext`.
- Do not enable `document.domain` or serve `Origin-Agent-Cluster: ?0`.
- Keep tools in the top-level, same-origin document.
- Clean registrations with `AbortController` on application teardown.
- Show a clear unsupported-browser message while keeping manual demo controls usable.
- Test in ChatGPT's in-app browser and the challenge-supported Chrome configuration.

## 14. Data Model

All MVP data is held in memory for the active page session.

### `LabSession`

```json
{
  "id": "uuid",
  "state": "healthy",
  "started_at": "ISO-8601",
  "ended_at": null,
  "active_fault": null,
  "health": {},
  "healthy_baseline": {},
  "failure_baseline": {},
  "timeline": []
}
```

### `Diagnosis`

```json
{
  "id": "uuid",
  "session_id": "uuid",
  "snapshot_hash": "string",
  "symptom": "silent_audio",
  "findings": [],
  "allowed_actions": [],
  "created_at": "ISO-8601"
}
```

### `RecoveryPlan`

```json
{
  "id": "uuid",
  "session_id": "uuid",
  "diagnosis_id": "uuid",
  "snapshot_hash": "string",
  "action": "enable_audio_track",
  "status": "staged",
  "approved_at": null,
  "expires_at": "ISO-8601",
  "applied_at": null,
  "verified_at": null
}
```

### `TimelineEvent`

```json
{
  "id": "uuid",
  "session_id": "uuid",
  "actor": "agent",
  "type": "diagnosis_completed",
  "summary": "Disabled outbound audio track detected",
  "evidence": {},
  "created_at": "ISO-8601"
}
```

## 15. Security, Privacy, and Human Control

1. Use generated media by default; do not record or upload audio/video.
2. Never include raw local/public IP addresses in tool outputs or reports.
3. Never expose complete SDP offers/answers.
4. Never expose credentials, tokens, or hidden environment values.
5. Accept only enum-based recovery actions.
6. Do not evaluate or execute agent-authored strings.
7. Require a valid diagnosis and snapshot match before staging a repair.
8. Require explicit user approval before application.
9. Prevent the agent from approving its own plan.
10. Expire plans and enforce one-time application.
11. Show every tool-driven action in the timeline.
12. Make the call reset action always available to the user.

## 16. Error Handling

All service and tool errors return a stable shape:

```json
{
  "ok": false,
  "error": {
    "code": "PLAN_NOT_APPROVED",
    "message": "The recovery plan requires explicit user approval.",
    "recoverable": true,
    "suggested_next_step": "Ask the user to approve or reject the staged plan."
  }
}
```

Required error codes:

- `WEBMCP_UNSUPPORTED`
- `NO_ACTIVE_SESSION`
- `SESSION_MISMATCH`
- `INVALID_STATE_TRANSITION`
- `STATS_UNAVAILABLE`
- `DIAGNOSIS_STALE`
- `ACTION_NOT_ALLOWED`
- `PLAN_NOT_APPROVED`
- `PLAN_EXPIRED`
- `PLAN_ALREADY_USED`
- `RECOVERY_FAILED`
- `VERIFICATION_INCOMPLETE`

Errors must be visible in the UI timeline and must not leave the lab in an ambiguous state.

## 17. Visual Direction

The interface should feel like a modern operations console, not a generic AI chat page.

### Design principles

- Dark neutral background with high-contrast status colors.
- Green for healthy, amber for degraded, red for critical, and blue for agent activity/recovery.
- Large health state and simple metrics before low-level details.
- Smooth but restrained animations for state transitions and metric updates.
- A visible human/agent/system timeline reinforces collaboration.
- Recovery confirmation must feel deliberate and trustworthy.
- Responsive layout for desktop and tablet; mobile may stack panels but is not the judging target.
- Meet basic keyboard navigation, focus visibility, contrast, and reduced-motion expectations.

### Suggested desktop layout

- Left column: media panel and fault controls.
- Center column: health status, metrics, and before/after view.
- Right column: agent collaboration timeline and recovery plan.

## 18. Acceptance Criteria

### Core session

- [ ] Demo Lab starts successfully without camera or microphone permission.
- [ ] Two actual peer connections reach `connected` or `completed` as appropriate.
- [ ] Generated audio and video counters progress.
- [ ] Session teardown stops tracks, closes peer connections, and clears timers.

### Diagnostics

- [ ] Audio-track fault produces a deterministic critical finding.
- [ ] Video-bitrate fault produces a deterministic degraded finding.
- [ ] Findings cite observable structured evidence.
- [ ] Unavailable metrics are labeled unavailable, not reported as zero.
- [ ] Tool output contains no raw IP address or SDP.

### Human-agent recovery

- [ ] Agent can discover and invoke all seven WebMCP tools.
- [ ] Read tools do not mutate call state.
- [ ] Staging a plan displays it in the UI.
- [ ] Applying before approval fails safely.
- [ ] Applying an expired or stale plan fails safely.
- [ ] An approved compatible repair changes the actual media state.
- [ ] Verification reports a measurable before/after difference.
- [ ] Every action appears in the visible timeline.

### Product quality

- [ ] Golden path can be completed in under two minutes during rehearsal.
- [ ] Reloading returns the app to a clean state.
- [ ] Unsupported WebMCP environments still show the manual demo.
- [ ] Layout works at common laptop resolutions.
- [ ] No console errors occur during the golden path.
- [ ] No network dependency is required after static assets load.

## 19. Test Plan

### Unit tests

- Lab state-machine transition table.
- Health deductions for each fault and healthy state.
- Diagnostic rule matching and action allowlists.
- Snapshot hashing and stale-plan detection.
- Plan expiry, approval, one-time use, and session binding.
- Sanitization of IP-like values, SDP fields, and device labels.
- Tool input validation and stable error results.

### Integration tests

- Generated media → loopback connection → healthy baseline.
- Audio fault → diagnosis → approved recovery → verified health.
- Bitrate fault → diagnosis → approved recovery → verified improvement.
- Rejected plan cannot execute.
- Changed fault invalidates the earlier plan.
- End/restart clears all session-owned state.

### Browser/manual tests

- ChatGPT in-app browser: discovery, read tools, plan staging, approval, write tool, verification, and report.
- Supported Chrome configuration: same golden path.
- WebMCP-disabled browser: graceful warning and functional manual controls.
- Page refresh during each major state.

## 20. Three-Minute Demo Script

Target duration: **2 minutes 30 seconds**, leaving a 30-second buffer.

| Time | Content |
| --- | --- |
| 0:00–0:15 | State the problem: browser-call failures are difficult to correlate and repair. |
| 0:15–0:35 | Start Demo Lab; show the healthy generated WebRTC call and live metrics. |
| 0:35–0:50 | Trigger **Break audio track**; health becomes critical and audio energy stops. |
| 0:50–1:20 | Ask the agent to diagnose; show WebMCP calls and the diagnosis appearing in the shared timeline. |
| 1:20–1:45 | Agent stages a repair; show evidence, risk, reversibility, and explicit user approval. |
| 1:45–2:05 | Agent applies the approved repair; audio and health recover. |
| 2:05–2:20 | Show before/after verification and the sanitized incident report. |
| 2:20–2:30 | Close: WebMCP turns live browser state into a safe human-agent recovery workflow. |

## 21. Implementation Order

### Milestone 1 — Deterministic WebRTC lab

- Scaffold Vue/Vite/Pinia application.
- Build generated audio/video sources.
- Build loopback peer service and teardown.
- Display connection, media, and basic stats.

Exit condition: One-click healthy session works repeatedly.

### Milestone 2 — Faults and health engine

- Implement audio-disable and bitrate-cap faults.
- Normalize stats and calculate deltas.
- Implement health status, score, deductions, and failure baseline.
- Build core workspace UI.

Exit condition: Both faults are deterministic and visually obvious.

### Milestone 3 — Recovery workflow

- Implement diagnoses and allowed-action mapping.
- Implement staged plan, approval, expiry, and safe executor.
- Implement before/after verification.
- Build timeline and recovery drawer.

Exit condition: Full manual golden path succeeds safely.

### Milestone 4 — WebMCP integration

- Register seven tools with lifecycle cleanup.
- Connect tools to existing services/stores.
- Add sanitized structured results and errors.
- Verify tool behavior in challenge-supported clients.

Exit condition: Agent completes the golden path without DOM clicking.

### Milestone 5 — Submission polish

- Responsive and accessibility pass.
- Automated tests and repeated clean-run rehearsals.
- Static deployment and browser verification.
- README, architecture diagram, license, screenshots, Devpost description, and video.

Exit condition: A new judge can understand and run the experience without assistance.

## 22. Scope-Cut Order

If time becomes constrained, cut in this order:

1. PDF export; keep on-screen/Markdown report.
2. Optional detached-track fault.
3. Advanced metric charts; retain key numbers and comparison cards.
4. Mobile-specific refinements beyond a functional stacked layout.
5. Video-bitrate fault only if browser behavior proves inconsistent; retain the flawless audio golden path.

Never cut:

- Real peer connection and real browser state.
- WebMCP diagnostic tools.
- Visible plan staging.
- Human approval before recovery.
- Actual state-changing recovery.
- Before/after verification.
- Sanitization and stable errors.

## 23. Main Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Experimental WebMCP API changes | Isolate registration in one adapter; use feature detection; validate against the supported clients daily. |
| Generated audio blocked by autoplay policy | Start `AudioContext` from the user's Start Demo Lab gesture and show a retry action. |
| Loopback metrics vary by browser | Base diagnosis first on authoritative track/sender state; use metric deltas as supporting evidence. |
| Bitrate cap is not visually dramatic | Display the configured cap and measured delta; keep audio failure as the video hero. |
| Agent tries to apply a repair directly | Enforce approval in application state; tool call fails without it. |
| Stale plan changes the wrong state | Bind plan to session and snapshot hash; revalidate immediately before execution. |
| Judges do not run the live app | Make the video demonstrate the complete story clearly and keep the README concise. |
| Similarity to monitoring products | Consistently position CallScope around live in-page collaboration, approval, repair, and verification. |

## 24. Submission Assets Checklist

- [ ] Public live HTTPS URL.
- [ ] Public repository with all functional source code.
- [ ] Detectable open-source license.
- [ ] Concise README with setup, architecture, supported browsers, and demo prompt.
- [ ] Screenshot of healthy state.
- [ ] Screenshot of staged recovery plan.
- [ ] Screenshot of before/after verification.
- [ ] Public YouTube video under three minutes with clear audio.
- [ ] English project description explaining why WebMCP is essential.
- [ ] Testing instructions and any necessary browser flag notes.
- [ ] Documented privacy/sanitization behavior.
- [ ] Commit history clearly within the challenge submission period.

## 25. Draft Submission Positioning

### Short description

CallScope is a live WebRTC rescue room where a person and an AI agent diagnose and safely recover a failing browser call together. WebMCP exposes the page's active peer-connection, media-track, and health state as structured tools. The agent can inspect evidence, stage a recovery plan, apply an allowlisted repair only after human approval, and verify the improvement in the same interface.

### What was difficult before

Troubleshooting a live browser call usually requires manually correlating raw statistics, track state, connection state, and sender configuration. A backend integration lacks the page's continuously changing local context, while general browser automation must infer technical state from UI elements.

### What WebMCP enables

CallScope gives the agent direct, structured access to the running page's existing diagnostic and recovery logic. The human sees the same evidence, approves any mutation, and receives a visible before/after result. The browser UI remains the shared workspace instead of being bypassed.

## 26. Locked Product Decisions

- Use CallScope as the working name until a separate availability check is completed.
- Build a self-contained WebRTC loopback lab.
- Use generated media as the default and judging path.
- Use Vue 3, Vite, JavaScript, and Pinia.
- Keep the core static and browser-only.
- Use the imperative WebMCP API.
- Implement seven focused tools.
- Require human approval in application state, independent of agent behavior.
- Make the disabled-audio scenario the hero demo.
- Keep the bitrate scenario as secondary proof of quantitative diagnostics.
- Exclude Janus, FreeSWITCH, FusionPBX, SIP, user accounts, and production monitoring from the MVP.

## 27. Definition of Done

CallScope is ready to submit when a judge can open the live URL, start a generated WebRTC session, introduce the hero fault, ask the browser agent to diagnose it, review and approve the staged recovery, watch the agent restore the actual media state, see objective before/after verification, and generate a sanitized incident report—without credentials, external infrastructure, undocumented setup, or developer assistance.
