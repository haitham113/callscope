import { describe, expect, it } from 'vitest'
import {
  suggestedToolsAfter,
  suggestedToolsForContext,
  suggestedToolsForError,
} from '../../src/features/webmcp/toolWorkflow.js'

describe('WebMCP conversational workflow policy', () => {
  it('pauses tool continuation while the staged plan awaits a human decision', () => {
    expect(suggestedToolsForContext({
      sessionId: 'session-1',
      state: 'awaiting_approval',
      planStatus: 'staged',
      hasVerification: false,
      hasDiagnosis: true,
      activeFault: 'disabled_audio',
    })).toEqual([])
    expect(suggestedToolsForContext({
      sessionId: 'session-1',
      state: 'awaiting_approval',
      planStatus: 'approved',
      hasVerification: false,
      hasDiagnosis: true,
      activeFault: 'disabled_audio',
    })).toEqual(['apply_recovery_action'])
    expect(suggestedToolsForContext({
      sessionId: 'session-1',
      state: 'verifying',
      planStatus: 'applied',
      hasVerification: false,
      hasDiagnosis: true,
      activeFault: 'disabled_audio',
    })).toEqual(['compare_to_failure_baseline'])
    expect(suggestedToolsForContext({
      sessionId: 'session-1',
      state: 'healthy',
      planStatus: 'verified',
      hasVerification: true,
      hasDiagnosis: true,
      activeFault: null,
    })).toEqual(['generate_incident_report'])
  })

  it('keeps all success and error continuations to at most two registered tools', () => {
    const continuations = [
      suggestedToolsAfter('inspect_call_state'),
      suggestedToolsAfter('run_call_diagnostics', { hasAllowedActions: true }),
      suggestedToolsAfter('stage_recovery_plan'),
      suggestedToolsAfter('apply_recovery_action'),
      suggestedToolsAfter('compare_to_failure_baseline'),
      suggestedToolsForError('SESSION_MISMATCH'),
      suggestedToolsForError('DIAGNOSIS_STALE'),
      suggestedToolsForError('PLAN_EXPIRED'),
    ]

    expect(continuations.every((tools) => tools.length <= 2)).toBe(true)
  })
})
