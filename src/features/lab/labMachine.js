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

const transitions = Object.freeze({
  idle: new Set(['starting']),
  starting: new Set(['healthy', 'failed', 'ended']),
  healthy: new Set(['critical', 'verifying', 'ended', 'failed']),
  degraded: new Set(['diagnosing', 'verifying', 'healthy', 'ended', 'failed']),
  critical: new Set(['diagnosing', 'awaiting_approval', 'verifying', 'healthy', 'ended', 'failed']),
  diagnosing: new Set(['critical', 'awaiting_approval', 'ended', 'failed']),
  awaiting_approval: new Set(['critical', 'recovering', 'verifying', 'ended', 'failed']),
  recovering: new Set(['verifying', 'critical', 'ended', 'failed']),
  verifying: new Set(['healthy', 'degraded', 'critical', 'ended', 'failed']),
  ended: new Set(['idle', 'starting']),
  failed: new Set(['idle', 'starting', 'ended']),
})

export function canTransition(from, to) {
  return transitions[from]?.has(to) ?? false
}

export function assertTransition(from, to) {
  if (!LAB_STATES.includes(from) || !LAB_STATES.includes(to) || !canTransition(from, to)) {
    throw new Error(`Invalid lab transition: ${from} -> ${to}`)
  }
}
