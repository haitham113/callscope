import { computed, onScopeDispose, ref, watch } from 'vue'

const COUNTDOWN_TICK_MS = 1_000
const COUNTDOWN_STATUSES = new Set(['staged', 'approved'])

export function useRecoveryPlanCountdown(plan, { now = () => Date.now() } = {}) {
  const clockMs = ref(now())
  let timerId = null

  function stopClock() {
    if (timerId !== null) clearInterval(timerId)
    timerId = null
  }

  function updateClock() {
    clockMs.value = now()
    const expiresAt = Date.parse(plan.value?.expires_at)
    if (Number.isFinite(expiresAt) && expiresAt <= clockMs.value) stopClock()
  }

  watch(
    () => [plan.value?.id, plan.value?.status, plan.value?.expires_at],
    ([id, status, expiresAt]) => {
      stopClock()
      updateClock()
      const expirationMs = Date.parse(expiresAt)
      if (
        !id ||
        !COUNTDOWN_STATUSES.has(status) ||
        !Number.isFinite(expirationMs) ||
        expirationMs <= clockMs.value
      ) return
      timerId = setInterval(updateClock, COUNTDOWN_TICK_MS)
    },
    { immediate: true },
  )

  const remainingSeconds = computed(() => {
    const expiresAt = Date.parse(plan.value?.expires_at)
    if (!Number.isFinite(expiresAt)) return null
    return Math.max(0, Math.floor((expiresAt - clockMs.value) / 1_000))
  })
  const expired = computed(() => {
    if (plan.value?.status === 'expired') return true
    return COUNTDOWN_STATUSES.has(plan.value?.status) && remainingSeconds.value === 0
  })
  const expiryText = computed(() => {
    if (!plan.value) return null
    if (expired.value) return 'Plan expired'
    if (!COUNTDOWN_STATUSES.has(plan.value.status) || remainingSeconds.value === null) return null
    const seconds = remainingSeconds.value
    return `Expires in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
  })

  onScopeDispose(stopClock)

  return { expired, expiryText, remainingSeconds }
}
