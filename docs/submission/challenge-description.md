# CallScope — English challenge description

## Short description

CallScope is a live WebRTC rescue room where a person and an AI agent diagnose and safely recover a failing browser call together. WebMCP exposes the page's active peer-connection, media-track, sender, and health state as seven structured tools. The agent can inspect evidence, stage an allowlisted repair, apply it only after human approval, and prove the result with a fresh before-and-after comparison.

## Full description

Browser-call failures are hard to troubleshoot because the decisive evidence is distributed across live `RTCPeerConnection` state, media tracks, sender parameters, ICE state, and changing `getStats()` counters. A support engineer normally has to correlate that low-level evidence manually, often while the incident is still unfolding.

CallScope turns the browser into a shared operations console for the engineer and an AI agent. A judge starts a deterministic generated-media call, introduces a real disabled-audio or constrained-video-sender fault, and asks the agent to diagnose it. The agent uses CallScope's WebMCP tools to inspect the live page state and stage a recovery plan with evidence, risk, reversibility, and expected result. The human—not the agent—approves or rejects the plan in the page. Approval does not change media. The user then sends an explicit second prompt, after which the agent can apply the one approved allowlisted action, sample fresh evidence, compare it with the failure baseline, and generate a sanitized incident report.

WebMCP is essential because the useful state exists inside the active page and changes continuously. A backend MCP service would need duplicated state, authentication, and a separate transport for browser-owned objects. DOM automation would infer technical state from labels. WebMCP lets the agent call the page's existing diagnostic and recovery services directly while the visible UI remains the human-controlled workspace.

The demo is fully browser-only: two real in-page peer connections, canvas video, Web Audio, and real browser statistics. It needs no camera, microphone, credentials, API key, backend, PBX, TURN server, uploaded logs, or customer calls. Raw IP addresses, SDP, device labels, credentials, and secrets are excluded from tool output, the timeline, and reports.

CallScope's core interaction is: Observe → Diagnose → Explain → Propose repair → Human approval → Apply → Verify.

## Links

- Live application: <https://haitham113.github.io/callscope/>
- Source repository: <https://github.com/haitham113/callscope>
- License: MIT
