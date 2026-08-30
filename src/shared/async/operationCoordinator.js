import { errorResult } from '../errors/serviceErrors.js'

export function createOperationCoordinator({ readIdentity }) {
  let activeSamplingWindow = null

  function beginSamplingWindow(kind) {
    if (activeSamplingWindow) return errorResult('INVALID_STATE_TRANSITION')
    const owner = readIdentity()
    const controller = new AbortController()
    const operation = Object.freeze({
      id: crypto.randomUUID(),
      kind,
      sessionId: owner.sessionId,
      sessionEpoch: owner.sessionEpoch,
      faultRevision: owner.faultRevision,
      signal: controller.signal,
      controller,
    })
    activeSamplingWindow = operation
    return { ok: true, operation }
  }

  function isCurrent(operation, { faultSensitive = true } = {}) {
    const current = readIdentity()
    return Boolean(
      operation &&
      activeSamplingWindow === operation &&
      !operation.signal.aborted &&
      current.sessionId === operation.sessionId &&
      current.sessionEpoch === operation.sessionEpoch &&
      (!faultSensitive || current.faultRevision === operation.faultRevision),
    )
  }

  function finish(operation) {
    if (activeSamplingWindow !== operation) return false
    activeSamplingWindow = null
    return true
  }

  function cancelAll(reason = 'Operation cancelled.') {
    if (!activeSamplingWindow) return false
    activeSamplingWindow.controller.abort(reason)
    activeSamplingWindow = null
    return true
  }

  return {
    beginSamplingWindow,
    isCurrent,
    finish,
    cancelAll,
    hasActiveSamplingWindow() {
      return activeSamplingWindow !== null
    },
  }
}
