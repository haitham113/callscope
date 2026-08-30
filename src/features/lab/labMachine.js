export const LAB_STATES = Object.freeze([
  'idle',
  'starting',
  'healthy',
  'ended',
  'failed',
])

const transitions = Object.freeze({
  idle: new Set(['starting']),
  starting: new Set(['healthy', 'failed', 'ended']),
  healthy: new Set(['ended', 'failed']),
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
