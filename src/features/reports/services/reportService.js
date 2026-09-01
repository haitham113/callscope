import { sanitizeValue } from '../../diagnostics/services/sanitizer.js'

export function createIncidentReport({
  sessionId,
  incidentRevision,
  startedAt,
  diagnosis,
  plan,
  verification,
  now = () => new Date(),
}) {
  const finding = diagnosis.findings[0]
  const recovered = verification.verdict === 'recovered'
  return sanitizeValue({
    id: `incident-${sessionId}-${incidentRevision}`,
    session_id: sessionId,
    incident_revision: incidentRevision,
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

export function createIncidentReportMarkdown(report) {
  const evidenceLines = report.sanitized_evidence.map((item) => {
    const role = item.role ? ` (${item.role})` : ''
    return `- ${item.field}: ${JSON.stringify(item.value)}${role}`
  })
  return sanitizeValue([
    '# CallScope Incident Report',
    '',
    `- Report: ${report.id}`,
    `- Session: ${report.session_id}`,
    `- Started: ${report.started_at}`,
    `- Generated: ${report.generated_at}`,
    '',
    '## Symptom',
    '',
    report.symptom,
    '',
    '## Root cause',
    '',
    report.root_cause,
    '',
    '## Sanitized evidence',
    '',
    ...(evidenceLines.length ? evidenceLines : ['- No decisive evidence was available.']),
    '',
    '## Approved recovery',
    '',
    `${report.approved_recovery.action} (${report.approved_recovery.risk} risk, reversible: ${report.approved_recovery.reversible})`,
    '',
    '## Verification',
    '',
    `${report.verification_result.verdict}; health score delta ${report.verification_result.health_score_delta}.`,
    '',
    '## Remaining recommendation',
    '',
    report.remaining_recommendations[0],
    '',
    '_Generated media only. Raw IP addresses, SDP, and device labels are excluded._',
  ].join('\n'))
}
