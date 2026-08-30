export const AUDIO_RECOVERY_ACTION = 'enable_audio_track'

export function diagnoseDisabledAudio(snapshot, createId = () => crypto.randomUUID()) {
  const audio = snapshot.tracks.audio
  const disabled =
    audio.ready_state === 'live' && audio.attached === true && audio.enabled === false
  const findings = disabled
    ? [
        {
          rank: 1,
          code: 'OUTBOUND_AUDIO_TRACK_DISABLED',
          title: 'Outbound audio track is disabled',
          severity: 'critical',
          confidence: 'high',
          evidence: [
            { field: 'tracks.audio.enabled', value: false, role: 'primary' },
            { field: 'tracks.audio.ready_state', value: audio.ready_state, role: 'primary' },
            { field: 'tracks.audio.attached', value: audio.attached, role: 'primary' },
            {
              field: 'metrics.audio_energy_delta',
              value: snapshot.metrics.audio_energy_delta,
              role: 'supporting',
            },
          ],
          limitations: [
            'Audio energy availability varies by browser and is supporting evidence only.',
            'Packet progression can continue while encoded silence is sent, so packets alone do not prove track enablement.',
          ],
          allowed_actions: [AUDIO_RECOVERY_ACTION],
        },
      ]
    : [
        {
          rank: 1,
          code: 'DISABLED_AUDIO_NOT_CONFIRMED',
          title: 'A disabled outbound audio track was not confirmed',
          severity: 'info',
          confidence: 'high',
          evidence: [
            { field: 'tracks.audio.enabled', value: audio.enabled, role: 'primary' },
            { field: 'tracks.audio.ready_state', value: audio.ready_state, role: 'primary' },
            { field: 'tracks.audio.attached', value: audio.attached, role: 'primary' },
          ],
          limitations: ['This rule diagnoses only the disabled-audio scenario.'],
          allowed_actions: [],
        },
      ]

  return {
    id: createId(),
    session_id: snapshot.session_id,
    session_epoch: snapshot.session_epoch,
    fault_revision: snapshot.fault_revision,
    snapshot_hash: snapshot.snapshot_hash,
    symptom: 'silent_audio',
    findings,
    allowed_actions: disabled ? [AUDIO_RECOVERY_ACTION] : [],
    created_at: new Date().toISOString(),
  }
}
