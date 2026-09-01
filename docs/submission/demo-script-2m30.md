# Exact 2:30 demo script

Target: 2 minutes 30 seconds. Do not add live improvisation; keep the final recording below three minutes.

| Time | Screen action | Narration |
| --- | --- | --- |
| 0:00–0:15 | Open the deployed CallScope page on the clean start state. | “WebRTC failures hide across tracks, senders, connection state, and changing statistics. CallScope gives a support engineer and an AI agent one safe place to diagnose and recover the live browser call.” |
| 0:15–0:35 | Click **Start Demo Lab**. Point to generated video, Healthy, connected peers, and progressing metrics. | “One click creates generated audio and video and connects two real in-page peer connections. There is no camera prompt, account, API key, backend, or external call infrastructure. Healthy appears only after real media counters progress.” |
| 0:35–0:50 | Click **Break audio track**. Point to Critical and `Audio live · disabled`. | “I’ll introduce the hero fault. CallScope disables the actual outbound audio track. The call becomes Critical and stores a failure baseline; this is not a cosmetic UI flag.” |
| 0:50–1:15 | Send: **Why is this call silent? Diagnose it and stage the safest repair.** Show exact tool names and actor badges in the timeline. | “The agent reads live page state through WebMCP, samples diagnostics, and stages the compatible `enable_audio_track` plan. Every call is visible as Agent activity with structured, sanitized evidence.” |
| 1:15–1:35 | Show evidence, low risk, reversibility, expiry, and the approval-only notice. Click **Approve recovery**. Keep Critical and disabled track visible. | “The human reviews the evidence and approves. Approval records consent only: the media is still broken, and the agent has no tool that can approve its own plan.” |
| 1:35–1:45 | Send: **Approved. Apply the repair, verify recovery, and generate the report.** | “WebMCP does not push approval to a waiting agent, so this explicit second prompt resumes the workflow deterministically.” |
| 1:45–2:05 | Show `apply_recovery_action`, then `compare_to_failure_baseline`; point to Recovering and Healthy. | “The app revalidates the approved plan immediately before mutation, re-enables the actual track, waits for fresh samples, and compares them with the failure baseline.” |
| 2:05–2:20 | Show the recovered before/after card and incident report. | “Recovery is proven, not assumed: the track changed from disabled to enabled, both peers remained connected, fresh media progressed, and the sanitized incident report excludes raw IP addresses and SDP.” |
| 2:20–2:30 | Return attention to the workflow strip and final Healthy state. | “CallScope shows why WebMCP matters: live browser evidence becomes a visible, human-approved recovery workflow in the same page.” |

## Exact prompts

First prompt:

> Why is this call silent? Diagnose it and stage the safest repair.

Second prompt, only after clicking **Approve recovery**:

> Approved. Apply the repair, verify recovery, and generate the report.
