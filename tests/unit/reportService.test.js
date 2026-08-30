import { describe, expect, it } from 'vitest'
import { createIncidentReport } from '../../src/features/reports/services/reportService.js'

function reportInput(overrides = {}) {
  return {
    sessionId: 'session-1',
    incidentRevision: 7,
    startedAt: '2026-01-01T00:00:00.000Z',
    diagnosis: {
      findings: [{ title: 'Outbound audio track is disabled', evidence: [] }],
    },
    plan: {
      action: 'enable_audio_track',
      risk: 'low',
      reversible: true,
      approved_at: '2026-01-01T00:00:02.000Z',
      applied_at: '2026-01-01T00:00:03.000Z',
    },
    verification: { verdict: 'recovered' },
    now: () => new Date('2026-01-01T00:00:04.000Z'),
    ...overrides,
  }
}

describe('incident report identity', () => {
  it('is stable for an unchanged incident revision and changes with the incident', () => {
    const first = createIncidentReport(reportInput())
    const repeated = createIncidentReport(reportInput({ now: () => new Date('2026-01-01T00:01:00.000Z') }))
    const changed = createIncidentReport(reportInput({ incidentRevision: 8 }))

    expect(repeated.id).toBe(first.id)
    expect(changed.id).not.toBe(first.id)
    expect(first.incident_revision).toBe(7)
  })
})
