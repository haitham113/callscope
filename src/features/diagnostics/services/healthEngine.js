function progresses(previous, current, keys) {
  if (!previous || !current) return false

  return keys.some((key) => {
    const before = previous[key]
    const after = current[key]
    return Number.isFinite(before) && Number.isFinite(after) && after > before
  })
}

function nonNegativeDelta(previous, current) {
  if (!Number.isFinite(previous) || !Number.isFinite(current)) return null
  const delta = current - previous
  return delta >= 0 ? delta : null
}

function readyStateOf(track) {
  return track?.ready_state ?? track?.readyState
}

export function evaluateCallHealth({ connection, tracks, receivers, progression }) {
  const requiredTracks = ['audio', 'video']
  const peersConnected =
    connection?.outbound === 'connected' && connection?.inbound === 'connected'
  const tracksReady = requiredTracks.every((kind) => {
    const track = tracks?.[kind]
    return readyStateOf(track) === 'live' && track.enabled === true && track.attached === true
  })
  const receiversReady = requiredTracks.every(
    (kind) => readyStateOf(receivers?.[kind]) === 'live',
  )
  const mediaProgressing = [
    progression?.outbound_audio,
    progression?.inbound_audio,
    progression?.outbound_video,
    progression?.inbound_video,
  ].every((value) => value === true)
  const checks = {
    peers_connected: peersConnected,
    tracks_live_enabled_attached: tracksReady,
    receiver_tracks_live: receiversReady,
    bidirectional_audio_video_progress: mediaProgressing,
  }
  const deductions = []

  if (!peersConnected) {
    deductions.push({
      code: 'PEERS_NOT_CONNECTED',
      severity: 'critical',
      points: 60,
      explanation: 'Both in-page peer connections must remain connected.',
    })
  }

  for (const kind of requiredTracks) {
    const track = tracks?.[kind]
    if (readyStateOf(track) !== 'live' || track?.attached !== true) {
      deductions.push({
        code: `${kind.toUpperCase()}_TRACK_UNAVAILABLE`,
        severity: 'critical',
        points: 50,
        explanation: `The outbound ${kind} track must be live and attached to its sender.`,
      })
    } else if (track.enabled !== true) {
      deductions.push({
        code: `${kind.toUpperCase()}_TRACK_DISABLED`,
        severity: 'critical',
        points: kind === 'audio' ? 45 : 40,
        explanation: `The actual outbound ${kind} track is disabled.`,
      })
    }

    if (readyStateOf(receivers?.[kind]) !== 'live') {
      deductions.push({
        code: `${kind.toUpperCase()}_RECEIVER_UNAVAILABLE`,
        severity: 'critical',
        points: 50,
        explanation: `The inbound ${kind} receiver track must remain live.`,
      })
    }
  }

  if (!mediaProgressing && !deductions.some((item) => item.severity === 'critical')) {
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
    healthy: Object.values(checks).every(Boolean),
    checks,
    health: {
      status: critical ? 'critical' : deductions.length ? 'degraded' : 'healthy',
      score,
      deductions,
    },
  }
}

export function evaluateHealthyEvidence({
  peers,
  tracks,
  receivers,
  previous,
  current,
}) {
  const countersProgressing =
    progresses(previous?.outbound?.audio, current?.outbound?.audio, [
      'packets',
      'bytes',
    ]) &&
    progresses(previous?.outbound?.video, current?.outbound?.video, [
      'frames',
      'packets',
      'bytes',
    ]) &&
    progresses(previous?.inbound?.audio, current?.inbound?.audio, [
      'packets',
      'bytes',
    ]) &&
    progresses(previous?.inbound?.video, current?.inbound?.video, [
      'frames',
      'packets',
      'bytes',
    ])

  return evaluateCallHealth({
    connection: peers,
    tracks,
    receivers,
    progression: {
      outbound_audio: countersProgressing,
      inbound_audio: countersProgressing,
      outbound_video: countersProgressing,
      inbound_video: countersProgressing,
    },
  })
}

export function deriveMetrics(previous, current) {
  if (!previous || !current || current.capturedAt <= previous.capturedAt) {
    return {
      outboundBitrateKbps: null,
      packetLoss: null,
      latencyMs: null,
      frameRate: null,
    }
  }

  const elapsedSeconds = (current.capturedAt - previous.capturedAt) / 1000
  const outboundByteDeltas = ['audio', 'video'].map((kind) =>
    nonNegativeDelta(
      previous.outbound[kind]?.bytes,
      current.outbound[kind]?.bytes,
    ),
  )
  const outboundBytes = outboundByteDeltas.every(Number.isFinite)
    ? outboundByteDeltas.reduce((total, delta) => total + delta, 0)
    : null
  const beforeFrames = previous.outbound.video?.frames
  const afterFrames = current.outbound.video?.frames
  const frameDelta = nonNegativeDelta(beforeFrames, afterFrames)
  const reportedFrameRate = current.outbound.video?.framesPerSecond
  const frameRate = Number.isFinite(frameDelta)
    ? frameDelta / elapsedSeconds
    : Number.isFinite(reportedFrameRate) && reportedFrameRate >= 0
      ? reportedFrameRate
      : null
  const packetLoss = nonNegativeDelta(
    previous.inbound.packetLoss,
    current.inbound.packetLoss,
  )

  return {
    outboundBitrateKbps: Number.isFinite(outboundBytes)
      ? (outboundBytes * 8) / elapsedSeconds / 1000
      : null,
    packetLoss,
    latencyMs: Number.isFinite(current.remote.roundTripTimeMs)
      ? current.remote.roundTripTimeMs
      : Number.isFinite(current.inbound.jitterMs)
        ? current.inbound.jitterMs
        : null,
    frameRate,
  }
}
