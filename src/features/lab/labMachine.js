export const LAB_STATES = Object.freeze([
  'idle',
  'starting',
  'healthy',
  'degraded',
  'critical',
  'diagnosing',
  'awaiting_approval',
  'recovering',
  'verifying',
  'ended',
  'failed',
])

export const LAB_TRANSITIONS = Object.freeze({
  idle: Object.freeze(['starting']),
  starting: Object.freeze(['healthy', 'failed', 'ended']),
  healthy: Object.freeze(['critical', 'verifying', 'ended', 'failed']),
  degraded: Object.freeze(['diagnosing', 'verifying', 'healthy', 'ended', 'failed']),
  critical: Object.freeze(['diagnosing', 'awaiting_approval', 'verifying', 'healthy', 'ended', 'failed']),
  diagnosing: Object.freeze(['critical', 'awaiting_approval', 'verifying', 'ended', 'failed']),
  awaiting_approval: Object.freeze(['critical', 'recovering', 'verifying', 'ended', 'failed']),
  recovering: Object.freeze(['verifying', 'critical', 'ended', 'failed']),
  verifying: Object.freeze(['healthy', 'degraded', 'critical', 'ended', 'failed']),
  ended: Object.freeze(['idle', 'starting']),
  failed: Object.freeze(['idle', 'starting', 'ended']),
})

export function canTransition(from, to) {
  return LAB_TRANSITIONS[from]?.includes(to) ?? false
}

export function assertTransition(from, to) {
  if (!LAB_STATES.includes(from) || !LAB_STATES.includes(to) || !canTransition(from, to)) {
    throw new Error(`Invalid lab transition: ${from} -> ${to}`)
  }
}
