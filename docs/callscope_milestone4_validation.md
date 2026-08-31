# Milestone 4 WebMCP validation record

Date: 2026-08-31  
Scope: disabled-audio WebMCP rescue only

## Local automated evidence (not a native-plugin record)

The production build was served through Vite preview and exercised in Google Chrome with a narrow `document.modelContext` registration double. The double supplied only registration/discovery/invocation wiring; the call, media mutation, statistics, approval state, verification, cleanup, and UI effects used real browser APIs and application services. The table records the exact request templates and response fields asserted by automation; it is not presented as the required native Inspector transcript.

| Tool | Exact input used | Structured result checked | Visible CallScope effect checked |
| --- | --- | --- | --- |
| `get_lab_context` | `{}` | Active `session_id`, `lab_state: "critical"`, `active_fault: "disabled_audio"`, `pending_plan_status`, and two next tools | Agent event titled exactly `get_lab_context` |
| `inspect_call_state` | `{"session_id":"<active session_id>","detail":"all"}` | Connected peers; audio `ready_state: "live"`, `enabled: false`, `attached: true`; critical health; explicit candidate/bitrate limitations | Agent event titled exactly `inspect_call_state`; media unchanged |
| `run_call_diagnostics` | `{"session_id":"<active session_id>","symptom":"silent_audio","sample_duration_ms":1000}` | New `diagnosis_id`, critical/high-confidence finding, decisive track evidence, start/end metrics, compatible `enable_audio_track` action | Diagnosis appears in the shared timeline; audio remains disabled |
| `stage_recovery_plan` | `{"session_id":"<active session_id>","diagnosis_id":"<returned diagnosis_id>","action":"enable_audio_track","reason":"The live outbound audio track is disabled while remaining live and attached.","expected_result":"Restore audio transmission without replacing the sender."}` | New `plan_id`, `status: "staged"`, low risk, reversible, expiry, `approval_applies_repair: false` | Recovery drawer opens with evidence and display-only agent text |
| `apply_recovery_action` before approval | `{"session_id":"<active session_id>","plan_id":"<returned plan_id>"}` | `PLAN_NOT_APPROVED` | Audio remains disabled; no comparison/report appears |
| `apply_recovery_action` after UI approval | Same input as above | `applied_action: "enable_audio_track"`, false→true authoritative state, stabilization wait, next tool `compare_to_failure_baseline` | Approval instruction was visible before invocation; actual track becomes enabled; report remains absent |
| `compare_to_failure_baseline` | `{"session_id":"<active session_id>","plan_id":"<returned plan_id>","sample_duration_ms":1000}` | Critical/55 before, Healthy/100 after, +45 score, four restored primary checks, `verdict: "recovered"` | Before/after panel displays `recovered` |
| `generate_incident_report` | `{"session_id":"<active session_id>","format":"markdown"}` | Report ID, structured sanitized sections, Markdown text, exclusion summary, `download_available: false` | Sanitized incident report appears |

Representative validation errors also passed:

- An unexpected `actor` field plus an invalid symptom returned `INVALID_TOOL_INPUT` before delegation.
- A synthetic wrong session ID returned `SESSION_MISMATCH`.
- Both errors produced exact-name Agent timeline events and left the actual audio track disabled.
- Reset during an Agent diagnostic returned `OPERATION_CANCELLED` and did not append a late exact-name tool event after fault ownership changed.
- End/restart during comparison returned `OPERATION_CANCELLED` and did not append a late exact-name tool event to the replacement session.

Commands and results:

- `npm test` — 21 files, 101 tests passed.
- `npm run lint` — passed with no warnings or errors.
- `npm run build` — passed; 40 modules transformed.
- `npm run test:browser` — 23 passed, 1 skipped. The skipped check was native `document.modelContext` discovery in Playwright's ordinary Chrome profile.

## Native WebMCP Inspector

Status: **NOT VERIFIED**.

Installed inspectors were found in the user's Chrome profile, including `WebMCP - Model Context Tool Inspector` 1.9.13. Attempts to load its installed code as an unpacked headless extension were blocked before the sidebar loaded. The actual `Default` profile could not be attached because Chrome reported that the profile was already in use. The running user browser was not terminated.

No native-inspector outputs are recorded as passes. Shortest rerun:

1. Close all Chrome windows, run `npm run build`, then `npm run preview`.
2. Launch Chrome with **WebMCP for testing** enabled and open `http://127.0.0.1:4173/`.
3. Open the installed WebMCP Inspector side panel and confirm exactly seven tools.
4. Start the lab, break audio, and invoke the exact inputs in the table, substituting returned IDs.
5. Confirm pre-approval apply returns `PLAN_NOT_APPROVED`; click **Approve recovery** in CallScope; invoke apply, compare, and report.
6. Save the side-panel outputs and confirm each exact tool name and User/Agent/System actors in the timeline.

Because this native run did not complete, no exact native request/response JSON is available to record. Placeholder IDs in the local automation table must be replaced with the returned UUIDs, timestamps, and complete sanitized response objects during that rerun.

## Public deployment and supported client

The current public URL returned HTTPS 200 and its judge-facing manual shell loaded. The Milestone 4 deployed check failed because that origin still served the earlier bundle and registered zero tools. The exact deployed command was `CALLSCOPE_BASE_URL=https://haitham113.github.io/callscope/ npm run test:browser -- tests/browser/webmcp-audio-rescue.spec.js`; it failed at tool discovery because no active handlers were registered. No deploy was performed because repository rules require separate explicit authorization.

ChatGPT's in-app browser status: **NOT VERIFIED**. It was not available in this environment, and the current public origin does not yet contain this Milestone 4 build.

After an authorized deployment, rerun:

```bash
CALLSCOPE_BASE_URL=https://haitham113.github.io/callscope/ npm run test:browser -- tests/browser/webmcp-audio-rescue.spec.js
```

Then repeat the golden prompt, human approval, explicit continuation, apply, compare, and report flow in ChatGPT's in-app browser.
