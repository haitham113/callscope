export function verifyDisabledAudioRecovery({ failureSnapshot, recoveredSnapshot }) {
  const beforeAudio = failureSnapshot.tracks.audio
  const afterAudio = recoveredSnapshot.tracks.audio
  const trackChanged = beforeAudio.enabled === false && afterAudio.enabled === true
  const trackAuthoritative =
    afterAudio.ready_state === 'live' && afterAudio.attached === true
  const peersConnected =
    recoveredSnapshot.connection.outbound === 'connected' &&
    recoveredSnapshot.connection.inbound === 'connected'
  const audioProgressing =
    recoveredSnapshot.media_progression.outbound_audio === true &&
    recoveredSnapshot.media_progression.inbound_audio === true
  const primaryChecks = {
    actual_track_changed_false_to_true: trackChanged,
    track_live_and_attached: trackAuthoritative,
    both_peers_connected: peersConnected,
    fresh_audio_media_progression: audioProgressing,
  }
  const passed = Object.values(primaryChecks).filter(Boolean).length
  const verdict =
    passed === Object.keys(primaryChecks).length
      ? 'recovered'
      : trackChanged && trackAuthoritative && peersConnected
        ? 'partially_recovered'
        : 'not_recovered'

  return {
    verdict,
    primary_checks: primaryChecks,
    before: {
      health_status: failureSnapshot.health.status,
      health_score: failureSnapshot.health.score,
      audio_track: beforeAudio,
      connection: failureSnapshot.connection,
      audio_energy_delta: failureSnapshot.metrics.audio_energy_delta,
    },
    after: {
      health_status: recoveredSnapshot.health.status,
      health_score: recoveredSnapshot.health.score,
      audio_track: afterAudio,
      connection: recoveredSnapshot.connection,
      audio_energy_delta: recoveredSnapshot.metrics.audio_energy_delta,
      audio_progression: {
        outbound: recoveredSnapshot.media_progression.outbound_audio,
        inbound: recoveredSnapshot.media_progression.inbound_audio,
      },
    },
    health_score_delta:
      recoveredSnapshot.health.score - failureSnapshot.health.score,
    limitations: [
      'Audio energy is supporting evidence only and may be unavailable.',
      'Packet progression is never used as proof that the track itself was re-enabled.',
    ],
  }
}

export function verifyVideoBitrateRecovery({ failureSnapshot, recoveredSnapshot }) {
  const beforeVideo = failureSnapshot.senders.video
  const afterVideo = recoveredSnapshot.senders.video
  const primaryChecks = {
    sender_cap_removed: beforeVideo.bitrate_limited === true && afterVideo.bitrate_limited === false,
    known_good_profile_readback_confirmed:
      afterVideo.readback_confirmed === true && afterVideo.profile_restored === true,
    video_sender_attached: afterVideo.attached === true,
    both_peers_connected:
      recoveredSnapshot.connection.outbound === 'connected' &&
      recoveredSnapshot.connection.inbound === 'connected',
  }
  const passed = Object.values(primaryChecks).filter(Boolean).length
  const verdict = passed === Object.keys(primaryChecks).length
    ? 'recovered'
    : primaryChecks.sender_cap_removed && primaryChecks.video_sender_attached
      ? 'partially_recovered'
      : 'not_recovered'
  const supportingEvidence = {
    outbound_bitrate_before_kbps: failureSnapshot.metrics.outbound_bitrate_kbps,
    outbound_bitrate_after_kbps: recoveredSnapshot.metrics.outbound_bitrate_kbps,
    frame_rate_before: failureSnapshot.metrics.frame_rate,
    frame_rate_after: recoveredSnapshot.metrics.frame_rate,
  }

  return {
    verdict,
    primary_checks: primaryChecks,
    before: {
      health_status: failureSnapshot.health.status,
      health_score: failureSnapshot.health.score,
      video_sender: beforeVideo,
      connection: failureSnapshot.connection,
    },
    after: {
      health_status: recoveredSnapshot.health.status,
      health_score: recoveredSnapshot.health.score,
      video_sender: afterVideo,
      connection: recoveredSnapshot.connection,
    },
    health_score_delta: recoveredSnapshot.health.score - failureSnapshot.health.score,
    supporting_evidence: supportingEvidence,
    limitations: [
      'Sender-parameter readback is primary verification evidence.',
      'Measured bitrate and frame rate are supporting only and may remain unavailable or noisy in local loopback.',
      'Visible quality change is browser-dependent and is not required for recovery.',
    ],
  }
}
