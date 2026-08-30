export const RECOVERY_STATES = Object.freeze([
  'draft',
  'staged',
  'approved',
  'rejected',
  'expired',
  'applied',
  'verified',
])

export const RECOVERY_TRANSITIONS = Object.freeze({
  draft: Object.freeze(['staged']),
  staged: Object.freeze(['approved', 'rejected', 'expired']),
  approved: Object.freeze(['applied', 'expired']),
  rejected: Object.freeze([]),
  expired: Object.freeze([]),
  applied: Object.freeze(['verified']),
  verified: Object.freeze([]),
})

export function canTransitionRecovery(from, to) {
  return RECOVERY_TRANSITIONS[from]?.includes(to) ?? false
}

export function assertRecoveryTransition(from, to) {
  if (!RECOVERY_STATES.includes(from) || !RECOVERY_STATES.includes(to) || !canTransitionRecovery(from, to)) {
    throw new Error(`Invalid recovery transition: ${from} -> ${to}`)
  }
}
