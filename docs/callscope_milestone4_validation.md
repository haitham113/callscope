# Milestone 4 WebMCP validation record

Date: 2026-09-01
Scope: disabled-audio WebMCP rescue only

## Gate summary

| Environment | Result | Evidence |
| --- | --- | --- |
| Patched production preview in WebMCP-enabled Chrome with the installed Inspector 1.9.13 | **PASS** | The native runtime discovered exactly seven tools and completed the audio rescue through the extension message path. No test-double invocation was used. |
| Public deployment in the same Chrome/Inspector environment | **FAIL** | The rescue remained safe and functional, but the deployed bundle predates three approved contract fixes listed below. |
| ChatGPT in-app browser | **NOT VERIFIED** | The supported client was unavailable. |

The Milestone 4 deployment gate is therefore **FAIL**. No deployment was performed because it was not authorized.

## Native WebMCP production-preview record

Google Chrome `151.0.7922.71` was launched with the user's installed **WebMCP - Model Context Tool Inspector** `1.9.13` and WebMCP testing flags. The Inspector content-script channel discovered and invoked the tools through the browser's native `document.modelContext`; page clicks were used only for the human actions Start call, Break audio, and Approve recovery.

Discovered tools, in the order returned by Chrome:

```json
["apply_recovery_action","compare_to_failure_baseline","generate_incident_report","get_lab_context","inspect_call_state","run_call_diagnostics","stage_recovery_plan"]
```

All seven registered input schemas had `additionalProperties: false`. The native inspection surface exposed `readOnlyHint` and `untrustedContentHint`; the complete four-field annotations were separately checked at the registration boundary by the contract tests.

### Golden-path transcript

Returned bindings:

```json
{
  "session_id": "c5df036e-fa5a-4daa-ad8f-dc785118ba71",
  "diagnosis_id": "77e4dab2-9d0f-4dfa-ada2-9f1be95e043c",
  "plan_id": "39a86f19-110d-4881-9e67-14d19e741d05"
}
```

| Tool and exact input | Structured output observed | Visible UI evidence and timing |
| --- | --- | --- |
| `get_lab_context` `{}` | Active bound session; `lab_state: "healthy"`; `health_label: "Healthy"`; `active_fault: null`; `pending_plan_status: null`; next tool `inspect_call_state`. | Agent timeline title exactly `get_lab_context`. Completed `22:01:46.632Z`–`22:01:46.644Z`. |
| `inspect_call_state` `{"session_id":"c5df036e-fa5a-4daa-ad8f-dc785118ba71","detail":"all"}` | Connected peers; audio and video tracks live, enabled, and attached; health score 100; candidate and bitrate availability limitations stated. | Agent timeline title exactly `inspect_call_state`; no media or recovery mutation. Completed `22:01:46.644Z`–`22:01:46.652Z`. |
| Page action: **Break audio** | Actual outbound audio track changed to disabled; failure baseline recorded. | UI health changed to Critical and audio showed disabled. This was a human page action, not a tool or DOM automation by a handler. |
| `run_call_diagnostics` `{"session_id":"c5df036e-fa5a-4daa-ad8f-dc785118ba71","symptom":"silent_audio","sample_duration_ms":1000}` | Diagnosis `77e4dab2-9d0f-4dfa-ada2-9f1be95e043c`; critical/high-confidence finding with `code: "OUTBOUND_AUDIO_TRACK_DISABLED"`, title `Outbound audio track is disabled`, decisive enabled/live/attached evidence, and compatible action `enable_audio_track`. | Exact Agent timeline name; track remained disabled. Completed `22:01:48.014Z`–`22:01:49.044Z`, truthfully including the sample. |
| `stage_recovery_plan` `{"session_id":"c5df036e-fa5a-4daa-ad8f-dc785118ba71","diagnosis_id":"77e4dab2-9d0f-4dfa-ada2-9f1be95e043c","action":"enable_audio_track","reason":"The live outbound audio track is disabled while remaining live and attached.","expected_result":"Restore audio transmission without replacing the sender."}` | Plan `39a86f19-110d-4881-9e67-14d19e741d05`; `status: "staged"`; low risk; reversible; expiry `2026-09-01T22:03:19.046Z`; `approval_applies_repair: false`; approval required. | Exact Agent timeline name; recovery drawer displayed evidence, approval controls, and the statement that approval does not apply the repair. Completed `22:01:49.044Z`–`22:01:49.062Z`. |
| `apply_recovery_action` `{"session_id":"c5df036e-fa5a-4daa-ad8f-dc785118ba71","plan_id":"39a86f19-110d-4881-9e67-14d19e741d05"}` before approval | Stable `PLAN_NOT_APPROVED` error with needed plan ID and next-tool guidance. | Exact Agent timeline name; authoritative audio state remained disabled and no comparison/report appeared. Completed `22:01:49.062Z`–`22:01:49.076Z`. |
| Page action: **Approve recovery** | Application approval changed to approved; no tool output. | Audio remained disabled. UI displayed: `Approved. Apply the repair, verify recovery, and generate the report.` |
| Same `apply_recovery_action` input after approval | `applied_action: "enable_audio_track"`; authoritative track state changed `false` → `true`; `stabilization_wait_ms: 1150`; next tool `compare_to_failure_baseline`. | Exact Agent timeline name; audio became enabled only during this invocation. Completed `22:01:49.133Z`–`22:01:50.329Z`. |
| `compare_to_failure_baseline` `{"session_id":"c5df036e-fa5a-4daa-ad8f-dc785118ba71","plan_id":"39a86f19-110d-4881-9e67-14d19e741d05","sample_duration_ms":1000}` | `verdict: "recovered"`; score 55 → 100; delta +45; all four primary recovery checks true; limitations retained. | Exact Agent timeline name; before/after panel displayed recovered. Completed `22:01:50.329Z`–`22:01:51.359Z`, truthfully including the fresh sample. |
| `generate_incident_report` `{"session_id":"c5df036e-fa5a-4daa-ad8f-dc785118ba71","format":"markdown"}` | Report `incident-c5df036e-fa5a-4daa-ad8f-dc785118ba71-13`; structured sanitized sections; Markdown includes `## Sanitized evidence`; `download_available: false`. | Exact Agent timeline name; sanitized report rendered. Completed `22:01:51.359Z`–`22:01:51.377Z`. |

Every visible tool event used actor `Agent`; the human page actions used `User`, and service-originated events used `System`. Recursive output scanning found no raw IP address, SDP, device label, credential, token, secret, or private key. A reload rediscovered exactly seven tools, with no duplicate registration.

### Negative-path evidence

The automated contract, service, and browser suites checked:

- no active session, wrong session, malformed/extra input, and unknown or stale diagnosis;
- rejected, expired, stale-snapshot, mismatched, unapproved, and already-used plans;
- immediate approval revalidation before mutation and no media mutation on every failed apply;
- cancellation during session/epoch replacement, remount during pending asynchronous registration, registration rejection, and abort cleanup;
- recursive sanitization of nested errors and report data;
- WebMCP-disabled fallback with the complete manual lab still functional.

The native Inspector golden path additionally proved the safety-critical `PLAN_NOT_APPROVED` branch, approval-only non-mutation, one-time post-approval apply, exact ID binding, exact Agent timeline names, truthful sample timing, recursive output privacy scan, and reload deduplication. Negative paths not individually invoked through the Inspector are not represented as native-manual passes; they are the automated results above.

## Automated verification

Commands actually run against the patched working tree:

- `npm test` — **PASS**, 21 files and 106 tests.
- `npm run lint` — **PASS**, no warnings or errors.
- `npm run build` — **PASS**, 40 modules transformed.
- `npm run test:browser -- tests/browser/webmcp-audio-rescue.spec.js` — **PASS**, 3 tests.
- `npm run test:browser` — **PASS**, 23 tests passed and 1 native-discovery test skipped in Playwright's ordinary profile.

An earlier overlapping-preview run produced `ERR_CONNECTION_REFUSED`; it was discarded and rerun once with a single clean preview process. The clean full run above is the recorded result.

## Public deployment

The same real Chrome/Inspector route completed the deployed audio rescue with these bindings:

```json
{
  "session_id": "d8f53507-9fa4-4637-bd32-378f0eaa427d",
  "diagnosis_id": "1d6ffea8-d3d3-4a67-89fb-d2044ae93a33",
  "plan_id": "51164b0b-adb8-4f07-9fc1-e8ef68898fbf"
}
```

The deployed origin discovered exactly seven tools, rejected pre-approval apply without mutation, left audio disabled after approval alone, applied only after the continuation, returned `recovered`, generated a sanitized report, survived reload without duplication, and produced no browser errors or disallowed output values.

Status is nevertheless **FAIL** because the public bundle predates these approved fixes:

1. Registered schemas omit `additionalProperties: false` although runtime validation rejects extra fields.
2. Diagnostic findings omit stable `code` and `title` fields.
3. Markdown reports omit the required `## Sanitized evidence` section.

No commit, push, or deployment was performed. The patched deployed contract therefore remains unverified.

## Supported-client check

ChatGPT's in-app browser: **NOT VERIFIED**. The client was not available in this environment. After an authorized deployment, repeat the two-message golden path there and require the same separate human approval, apply, compare, and report evidence before passing the gate.
