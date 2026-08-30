import { deriveMetrics, evaluateCallHealth } from './healthEngine.js'
import { sanitizeValue } from './sanitizer.js'

function progressed(previous, current, keys) {
  if (!previous || !current) return null
  const comparable = keys.filter(
    (key) => Number.isFinite(previous[key]) && Number.isFinite(current[key]),
  )
  if (comparable.length === 0) return null
  return comparable.some((key) => current[key] > previous[key])
}

function delta(previous, current) {
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return null
  return current >= previous ? current - previous : null
}

export function createAuthoritativeSnapshot({
  sessionId,
  sessionEpoch,
  faultRevision,
  activeFault,
  peerStatus,
  previousSample,
  currentSample,
  capturedAt = new Date().toISOString(),
}) {
  const metrics = deriveMetrics(previousSample, currentSample)
  const progression = {
    outbound_audio: progressed(previousSample?.outbound?.audio, currentSample?.outbound?.audio, ['packets', 'bytes']),
    inbound_audio: progressed(previousSample?.inbound?.audio, currentSample?.inbound?.audio, ['packets', 'bytes']),
    outbound_video: progressed(previousSample?.outbound?.video, currentSample?.outbound?.video, ['frames', 'packets', 'bytes']),
    inbound_video: progressed(previousSample?.inbound?.video, currentSample?.inbound?.video, ['frames', 'packets', 'bytes']),
  }
  const tracks = Object.fromEntries(
    ['audio', 'video'].map((kind) => [
      kind,
      {
        ready_state: peerStatus.tracks[kind].readyState,
        enabled: peerStatus.tracks[kind].enabled,
        attached: peerStatus.tracks[kind].attached,
      },
    ]),
  )
  const receivers = Object.fromEntries(
    ['audio', 'video'].map((kind) => [
      kind,
      { ready_state: peerStatus.receivers[kind].readyState },
    ]),
  )
  const snapshot = {
    session_id: sessionId,
    session_epoch: sessionEpoch,
    fault_revision: faultRevision,
    captured_at: capturedAt,
    active_fault: activeFault,
    connection: { ...peerStatus.connection },
    tracks,
    receivers,
    media_progression: progression,
    metrics: {
      outbound_bitrate_kbps: metrics.outboundBitrateKbps,
      packet_loss: metrics.packetLoss,
      latency_ms: metrics.latencyMs,
      frame_rate: metrics.frameRate,
      audio_energy_delta: delta(
        previousSample?.inbound?.totalAudioEnergy,
        currentSample?.inbound?.totalAudioEnergy,
      ),
    },
  }
  snapshot.health = evaluateCallHealth({
    connection: snapshot.connection,
    tracks,
    receivers,
    progression,
  }).health
  return sanitizeValue(snapshot)
}

export function snapshotBinding(snapshot) {
  return {
    session_id: snapshot.session_id,
    session_epoch: snapshot.session_epoch,
    fault_revision: snapshot.fault_revision,
    active_fault: snapshot.active_fault,
    connection: snapshot.connection,
    tracks: snapshot.tracks,
    receivers: snapshot.receivers,
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export async function hashSnapshot(snapshot) {
  const bytes = new TextEncoder().encode(stableStringify(snapshotBinding(snapshot)))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
