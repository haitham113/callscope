import { deriveMetrics } from './healthEngine.js'
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

function statusAndScore(connection, tracks, progression) {
  const deductions = []
  const peersConnected =
    connection.outbound === 'connected' && connection.inbound === 'connected'
  if (!peersConnected) {
    deductions.push({
      code: 'PEERS_NOT_CONNECTED',
      severity: 'critical',
      points: 60,
      explanation: 'Both in-page peer connections must remain connected.',
    })
  }

  for (const kind of ['audio', 'video']) {
    const track = tracks[kind]
    if (track.ready_state !== 'live' || !track.attached) {
      deductions.push({
        code: `${kind.toUpperCase()}_TRACK_UNAVAILABLE`,
        severity: 'critical',
        points: 50,
        explanation: `The outbound ${kind} track must be live and attached to its sender.`,
      })
    }
  }

  if (tracks.audio.ready_state === 'live' && tracks.audio.attached && !tracks.audio.enabled) {
    deductions.push({
      code: 'AUDIO_TRACK_DISABLED',
      severity: 'critical',
      points: 45,
      explanation: 'The actual outbound audio track is disabled.',
    })
  }

  const mediaProgressing = [
    progression.outbound_audio,
    progression.inbound_audio,
    progression.outbound_video,
    progression.inbound_video,
  ].every((value) => value === true)
  if (!mediaProgressing && deductions.length === 0) {
    deductions.push({
      code: 'MEDIA_PROGRESSION_INCOMPLETE',
      severity: 'warning',
      points: 20,
      explanation: 'A fresh sample has not confirmed progression for every media direction.',
    })
  }

  const score = Math.max(
    0,
    100 - deductions.reduce((total, deduction) => total + deduction.points, 0),
  )
  const critical = deductions.some((deduction) => deduction.severity === 'critical')
  return {
    status: critical ? 'critical' : deductions.length ? 'degraded' : 'healthy',
    score,
    deductions,
  }
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
  const snapshot = {
    session_id: sessionId,
    session_epoch: sessionEpoch,
    fault_revision: faultRevision,
    captured_at: capturedAt,
    active_fault: activeFault,
    connection: { ...peerStatus.connection },
    tracks,
    receivers: Object.fromEntries(
      ['audio', 'video'].map((kind) => [
        kind,
        { ready_state: peerStatus.receivers[kind].readyState },
      ]),
    ),
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
  snapshot.health = statusAndScore(snapshot.connection, tracks, progression)
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
