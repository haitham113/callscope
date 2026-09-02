import { sanitizeValue } from '../../features/diagnostics/services/sanitizer.js'

export const ERROR_DEFINITIONS = Object.freeze({
  INVALID_TOOL_INPUT: Object.freeze({ message: 'The WebMCP tool input is invalid.', recoverable: true, suggested_next_step: 'Retry with an input that matches the registered schema.' }),
  WEBMCP_UNSUPPORTED: Object.freeze({ message: 'WebMCP is unavailable in this browser.', recoverable: true, suggested_next_step: 'Use the manual controls or open CallScope in a supported browser.' }),
  WEBMCP_REGISTRATION_FAILED: Object.freeze({ message: 'CallScope could not register its WebMCP tools.', recoverable: true, suggested_next_step: 'Reload CallScope in a supported browser and inspect WebMCP availability again.' }),
  NO_ACTIVE_SESSION: Object.freeze({ message: 'No active lab session is available.', recoverable: true, suggested_next_step: 'Start a new demo lab session.' }),
  SESSION_MISMATCH: Object.freeze({ message: 'The request belongs to a different lab session.', recoverable: true, suggested_next_step: 'Inspect the active session and retry with its session identifier.' }),
  INVALID_STATE_TRANSITION: Object.freeze({ message: 'The requested operation is not valid in the current lab state.', recoverable: true, suggested_next_step: 'Wait for the active operation or reset the lab.' }),
  STATS_UNAVAILABLE: Object.freeze({ message: 'Authoritative WebRTC statistics are unavailable.', recoverable: true, suggested_next_step: 'Retry the sample or restart the lab.' }),
  DIAGNOSIS_STALE: Object.freeze({ message: 'The live fault state no longer matches the diagnosis.', recoverable: true, suggested_next_step: 'Run diagnostics again against a fresh snapshot.' }),
  ACTION_NOT_ALLOWED: Object.freeze({ message: 'The requested recovery action is not allowed by this diagnosis.', recoverable: true, suggested_next_step: 'Use an action listed by the current diagnosis.' }),
  PLAN_NOT_APPROVED: Object.freeze({ message: 'The recovery plan requires explicit user approval.', recoverable: true, suggested_next_step: 'Ask the user to approve or reject the staged plan.' }),
  PLAN_EXPIRED: Object.freeze({ message: 'The recovery plan has expired.', recoverable: true, suggested_next_step: 'Capture a fresh diagnosis and stage a new plan.' }),
  PLAN_ALREADY_USED: Object.freeze({ message: 'This recovery plan has already been used.', recoverable: true, suggested_next_step: 'Diagnose the current state again if another repair is needed.' }),
  RECOVERY_FAILED: Object.freeze({ message: 'The approved recovery could not be applied safely.', recoverable: false, suggested_next_step: 'Reset the scenario or restart the lab.' }),
  VERIFICATION_INCOMPLETE: Object.freeze({ message: 'Recovery verification has not been completed successfully.', recoverable: true, suggested_next_step: 'Retry verification or reset the lab based on the active workflow.' }),
  DIAGNOSIS_NOT_FOUND: Object.freeze({ message: 'The requested diagnosis was not found.', recoverable: true, suggested_next_step: 'Run diagnostics again and use the returned diagnosis identifier.' }),
  PLAN_NOT_FOUND: Object.freeze({ message: 'The requested recovery plan was not found.', recoverable: true, suggested_next_step: 'Stage a compatible recovery plan first.' }),
  MEDIA_CAPABILITY_UNSUPPORTED: Object.freeze({ message: 'A required browser media capability is unavailable.', recoverable: false, suggested_next_step: 'Open CallScope in a supported Chromium browser.' }),
  LAB_START_FAILED: Object.freeze({ message: 'The demo lab could not start.', recoverable: true, suggested_next_step: 'Review the failure timeline and retry the lab.' }),
  FAULT_MUTATION_FAILED: Object.freeze({ message: 'The browser could not safely apply the simulated fault.', recoverable: true, suggested_next_step: 'Reset or restart the lab before trying again.' }),
  OPERATION_CANCELLED: Object.freeze({ message: 'The operation was cancelled because its owning session changed.', recoverable: true, suggested_next_step: 'Inspect the active session before retrying.' }),
  CLEANUP_INCOMPLETE: Object.freeze({ message: 'One or more tracked browser resources did not confirm release.', recoverable: false, suggested_next_step: 'Reset the lab or reload the page before starting another session.' }),
})

export const ERROR_CODES = Object.freeze(Object.keys(ERROR_DEFINITIONS))

export class ServiceError extends Error {
  constructor(code, options = {}) {
    const definition = ERROR_DEFINITIONS[code]
    if (!definition) throw new Error(`Unknown service error code: ${code}`)
    super(definition.message, options)
    this.name = 'ServiceError'
    this.code = code
  }
}

export function errorResult(code) {
  const definition = ERROR_DEFINITIONS[code]
  if (!definition) throw new Error(`Unknown service error code: ${code}`)
  return sanitizeValue({ ok: false, error: { code, ...definition } })
}

export function resultFromError(error, fallbackCode) {
  const code = ERROR_DEFINITIONS[error?.code] ? error.code : fallbackCode
  return errorResult(code)
}

export function serviceError(code, options) {
  return new ServiceError(code, options)
}
