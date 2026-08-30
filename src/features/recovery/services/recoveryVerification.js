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
