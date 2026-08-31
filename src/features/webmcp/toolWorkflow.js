export function suggestedToolsForContext({
  sessionId,
  state,
  planStatus,
  hasVerification,
  hasDiagnosis,
  activeFault,
}) {
  if (!sessionId || ['idle', 'ended'].includes(state)) return []
  if (planStatus === 'approved') return ['apply_recovery_action']
  if (planStatus === 'staged') return []
  if (hasVerification) return ['compare_to_failure_baseline', 'generate_incident_report']
  if (hasDiagnosis) return ['stage_recovery_plan']
  if (activeFault) return ['inspect_call_state', 'run_call_diagnostics']
  return ['inspect_call_state']
}

export function suggestedToolsAfter(toolName, { hasAllowedActions = false } = {}) {
  const next = {
    inspect_call_state: ['run_call_diagnostics'],
    stage_recovery_plan: ['apply_recovery_action'],
    apply_recovery_action: ['compare_to_failure_baseline'],
    compare_to_failure_baseline: ['generate_incident_report'],
    generate_incident_report: [],
  }
  if (toolName === 'run_call_diagnostics') {
    return hasAllowedActions ? ['stage_recovery_plan'] : ['inspect_call_state']
  }
  return next[toolName] ?? []
}

export function suggestedToolsForError(code) {
  if (['NO_ACTIVE_SESSION', 'SESSION_MISMATCH', 'OPERATION_CANCELLED'].includes(code)) {
    return ['get_lab_context']
  }
  if (['DIAGNOSIS_NOT_FOUND', 'DIAGNOSIS_STALE'].includes(code)) {
    return ['run_call_diagnostics']
  }
  if (['PLAN_NOT_FOUND', 'PLAN_EXPIRED'].includes(code)) return ['stage_recovery_plan']
  if (code === 'VERIFICATION_INCOMPLETE') return ['compare_to_failure_baseline']
  return []
}
