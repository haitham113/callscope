import { sanitizeValue } from '../../diagnostics/services/sanitizer.js'

export function createIncidentReport({
  sessionId,
  startedAt,
  diagnosis,
  plan,
  verification,
  now = () => new Date(),
  createId = () => crypto.randomUUID(),
}) {
  const finding = diagnosis.findings[0]
  const recovered = verification.verdict === 'recovered'
  return sanitizeValue({
    id: createId(),
    session_id: sessionId,
    started_at: startedAt,
    generated_at: now().toISOString(),
    symptom: 'Remote audio became silent after the demo audio fault was introduced.',
    root_cause: finding.title,
    sanitized_evidence: finding.evidence,
    approved_recovery: {
      action: plan.action,
      risk: plan.risk,
      reversible: plan.reversible,
      approved_at: plan.approved_at,
      applied_at: plan.applied_at,
    },
    verification_result: verification,
    remaining_recommendations: recovered
      ? ['No remaining audio fault detected. Continue monitoring the live session.']
      : ['Reset the scenario or restart the lab before attempting another recovery.'],
    sanitization: {
      generated_media_only: true,
      raw_ip_addresses_excluded: true,
      sdp_excluded: true,
      device_labels_excluded: true,
    },
  })
}
