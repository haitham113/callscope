import { sanitizeValue } from '../diagnostics/services/sanitizer.js'
import { resultFromError } from '../../shared/errors/serviceErrors.js'
import { TOOL_DEFINITIONS } from './toolSchemas.js'
import {
  suggestedToolsAfter,
  suggestedToolsForContext,
  suggestedToolsForError,
} from './toolWorkflow.js'

const REQUIRED_CAPABILITIES = Object.freeze([
  'getLabContext',
  'inspectCallState',
  'runDiagnostics',
  'stageRecoveryPlan',
  'applyRecoveryAction',
  'compareToFailureBaseline',
  'generateIncidentReport',
  'captureToolInvocation',
  'recordToolEvent',
])

function validateCapabilities(agent) {
  if (typeof agent?.approvePlan === 'function' || typeof agent?.rejectPlan === 'function') {
    throw new Error('WebMCP handlers must not receive approval capabilities.')
  }
  for (const capability of REQUIRED_CAPABILITIES) {
    if (typeof agent?.[capability] !== 'function') {
      throw new Error(`Missing agent-safe capability: ${capability}`)
    }
  }
}

function validateInput(input, schema) {
  const value = input ?? {}
  const issues = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ['Input must be an object.']
  }
  const propertyNames = Object.keys(schema.properties)
  for (const key of Object.keys(value)) {
    if (!propertyNames.includes(key)) issues.push(`Unexpected property: ${key}.`)
  }
  for (const key of schema.required ?? []) {
    if (!(key in value)) issues.push(`Missing required property: ${key}.`)
  }
  for (const [key, property] of Object.entries(schema.properties)) {
    if (!(key in value)) continue
    const candidate = value[key]
    if (property.type === 'string' && typeof candidate !== 'string') {
      issues.push(`${key} must be a string.`)
      continue
    }
    if (property.type === 'integer' && !Number.isInteger(candidate)) {
      issues.push(`${key} must be an integer.`)
      continue
    }
    if (property.enum && !property.enum.includes(candidate)) {
      issues.push(`${key} must be one of: ${property.enum.join(', ')}.`)
    }
    if (property.maxLength !== undefined && candidate.length > property.maxLength) {
      issues.push(`${key} must be at most ${property.maxLength} characters.`)
    }
    if (property.minimum !== undefined && candidate < property.minimum) {
      issues.push(`${key} must be at least ${property.minimum}.`)
    }
    if (property.maximum !== undefined && candidate > property.maximum) {
      issues.push(`${key} must be at most ${property.maximum}.`)
    }
  }
  return issues
}

function invalidInput(issues) {
  return sanitizeValue({
    ok: false,
    error: {
      code: 'INVALID_TOOL_INPUT',
      message: 'The WebMCP tool input does not match its registered schema.',
      recoverable: true,
      suggested_next_step: 'Retry with only the documented fields and allowed values.',
      issues,
    },
    limitations: [],
    needed_ids: {},
    suggested_next_tools: ['get_lab_context'],
  })
}

function decorateFailure(result) {
  const safe = sanitizeValue(result)
  return {
    ...safe,
    limitations: [],
    needed_ids: {},
    suggested_next_tools: suggestedToolsForError(safe.error?.code),
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

export function createWebMcpToolHandlers(agent) {
  validateCapabilities(agent)
  const definitions = Object.fromEntries(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]))

  function wrap(toolName, operation) {
    return async (input = {}) => {
      const invocation = agent.captureToolInvocation()
      const issues = validateInput(input, definitions[toolName].inputSchema)
      if (issues.length) {
        const result = invalidInput(issues)
        agent.recordToolEvent(toolName, result, invocation)
        return result
      }
      let result
      try {
        result = await operation(input)
      } catch (error) {
        result = decorateFailure(resultFromError(error, 'INVALID_STATE_TRANSITION'))
      }
      const safeResult = sanitizeValue(result?.ok === false ? decorateFailure(result) : result)
      agent.recordToolEvent(toolName, safeResult, invocation)
      return safeResult
    }
  }

  return Object.freeze({
    get_lab_context: wrap('get_lab_context', async () => {
      const result = await agent.getLabContext()
      if (!result.ok) return result
      return {
        ok: true,
        session_id: result.session_id,
        lab_state: result.lab_state,
        health_status: result.health_status,
        active_fault: result.active_fault,
        pending_plan_id: result.pending_plan_id,
        pending_plan_status: result.pending_plan_status,
        webmcp_supported: result.webmcp_supported,
        limitations: result.limitations ?? [],
        needed_ids: result.session_id ? { session_id: result.session_id } : {},
        suggested_next_tools: suggestedToolsForContext({
          sessionId: result.session_id,
          state: result.lab_state,
          planStatus: result.pending_plan_status,
          hasVerification: result.has_verification,
          hasDiagnosis: result.has_diagnosis,
          activeFault: result.active_fault,
        }),
      }
    }),

    inspect_call_state: wrap('inspect_call_state', async ({ session_id, detail = 'summary' }) => {
      const result = await agent.inspectCallState({ sessionId: session_id, detail })
      if (!result.ok) return result
      return {
        ...result,
        needed_ids: { session_id },
        suggested_next_tools: result.suggested_next_tools ?? suggestedToolsAfter('inspect_call_state'),
      }
    }),

    run_call_diagnostics: wrap('run_call_diagnostics', async ({
      session_id,
      symptom,
      sample_duration_ms = 2000,
    }) => {
      const result = await agent.runDiagnostics({
        sessionId: session_id,
        symptom,
        sampleDurationMs: sample_duration_ms,
      })
      if (!result.ok) return result
      const findings = result.diagnosis.findings.map((finding) => ({
        rank: finding.rank,
        code: finding.code,
        title: finding.title,
        severity: finding.severity,
        confidence: finding.confidence,
        evidence: finding.evidence,
        allowed_recovery_actions: finding.allowed_actions,
      }))
      return {
        ok: true,
        diagnosis_id: result.diagnosis.id,
        findings,
        metrics: {
          start: result.metrics_at_start ?? null,
          end: result.snapshot.metrics,
        },
        limitations: unique(result.diagnosis.findings.flatMap((finding) => finding.limitations)),
        needed_ids: { session_id, diagnosis_id: result.diagnosis.id },
        suggested_next_tools: suggestedToolsAfter('run_call_diagnostics', {
          hasAllowedActions: result.diagnosis.allowed_actions.length > 0,
        }),
      }
    }),

    stage_recovery_plan: wrap('stage_recovery_plan', async ({
      session_id,
      diagnosis_id,
      action,
      reason,
      expected_result,
    }) => {
      const result = await agent.stageRecoveryPlan({
        sessionId: session_id,
        diagnosisId: diagnosis_id,
        action,
        reason,
        expectedResult: expected_result,
      })
      if (!result.ok) return result
      return {
        ok: true,
        plan_id: result.plan.id,
        status: result.plan.status,
        risk: result.plan.risk,
        reversible: result.plan.reversible,
        expires_at: result.plan.expires_at,
        approval_applies_repair: false,
        message: 'The plan is visible in CallScope. Explicit human approval is required, and approval does not apply the repair.',
        limitations: ['Agent-authored reason and expected-result text are display-only and never executable.'],
        needed_ids: { session_id, diagnosis_id, plan_id: result.plan.id },
        suggested_next_tools: suggestedToolsAfter('stage_recovery_plan'),
      }
    }),

    apply_recovery_action: wrap('apply_recovery_action', async ({ session_id, plan_id }) => {
      const result = await agent.applyRecoveryAction({ sessionId: session_id, planId: plan_id })
      if (!result.ok) return result
      return {
        ok: true,
        session_id,
        plan_id,
        applied_action: result.action,
        previous_state: result.previous_state,
        new_state: result.new_state,
        stabilization_wait_ms: result.stabilization_wait_ms,
        limitations: ['Successful mutation alone is not proof of recovery; compare fresh evidence next.'],
        needed_ids: { session_id, plan_id },
        suggested_next_tools: suggestedToolsAfter('apply_recovery_action'),
      }
    }),

    compare_to_failure_baseline: wrap('compare_to_failure_baseline', async ({
      session_id,
      plan_id,
      sample_duration_ms = 2000,
    }) => {
      const result = await agent.compareToFailureBaseline({
        sessionId: session_id,
        planId: plan_id,
        sampleDurationMs: sample_duration_ms,
      })
      if (!result.ok) return result
      const verification = result.verification
      return {
        ok: true,
        session_id,
        plan_id,
        before: verification.before,
        after: verification.after,
        health_score_delta: verification.health_score_delta,
        restored_states: verification.primary_checks,
        relevant_metric_deltas: {
          audio_energy_before: verification.before?.audio_energy_delta ?? null,
          audio_energy_after: verification.after?.audio_energy_delta ?? null,
        },
        verdict: verification.verdict,
        remaining_findings: Object.entries(verification.primary_checks)
          .filter(([, passed]) => !passed)
          .map(([check]) => check),
        limitations: verification.limitations,
        needed_ids: { session_id, plan_id },
        suggested_next_tools: suggestedToolsAfter('compare_to_failure_baseline'),
      }
    }),

    generate_incident_report: wrap('generate_incident_report', async ({
      session_id,
      format = 'summary',
    }) => {
      const result = await agent.generateIncidentReport({ sessionId: session_id, format })
      if (!result.ok) return result
      return {
        ok: true,
        report_id: result.report.id,
        format,
        sections: result.report,
        ...(format === 'markdown' ? { markdown: result.markdown } : {}),
        sanitization_summary: result.report.sanitization,
        download_available: false,
        limitations: ['Markdown is returned as sanitized text; file download is not available in this milestone.'],
        needed_ids: { session_id, report_id: result.report.id },
        suggested_next_tools: suggestedToolsAfter('generate_incident_report'),
      }
    }),
  })
}
