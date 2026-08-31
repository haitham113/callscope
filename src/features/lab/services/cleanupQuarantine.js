export function createCleanupQuarantine() {
  const pending = new Set()

  function attempt(record) {
    pending.add(record)
    if (record.inFlight) return record.inFlight
    record.inFlight = (async () => {
      let receipt
      try {
        receipt = await record.cleanup()
      } catch {
        receipt = { complete: false }
      }
      if (receipt?.complete) pending.delete(record)
      return receipt
    })().finally(() => {
      record.inFlight = null
    })
    return record.inFlight
  }

  return Object.freeze({
    async track(cleanup) {
      return attempt({ cleanup, inFlight: null })
    },
    async drain() {
      for (const record of [...pending]) await attempt(record)
      return { complete: pending.size === 0, pending: pending.size }
    },
    pendingCount() {
      return pending.size
    },
  })
}
