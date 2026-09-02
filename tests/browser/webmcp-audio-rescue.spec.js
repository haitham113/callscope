import { expect, test } from '@playwright/test'

const TOOL_NAMES = [
  'get_lab_context',
  'inspect_call_state',
  'run_call_diagnostics',
  'stage_recovery_plan',
  'apply_recovery_action',
  'compare_to_failure_baseline',
  'generate_incident_report',
]

function collectBrowserErrors(page) {
  const errors = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  return errors
}

async function installModelContextDouble(page) {
  await page.addInitScript(() => {
    const registrations = []
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        async registerTool(tool, { signal }) {
          const registration = { tool, signal, active: true }
          signal.addEventListener('abort', () => { registration.active = false }, { once: true })
          registrations.push(registration)
        },
      },
    })
    window.__callscopeWebMcpTest = {
      registrations,
      invoke(name, input) {
        const registration = [...registrations]
          .reverse()
          .find((item) => item.active && item.tool.name === name)
        if (!registration) throw new Error(`WebMCP tool is not active: ${name}`)
        return registration.tool.execute(input)
      },
    }
  })
}

async function invoke(page, name, input = {}) {
  return page.evaluate(
    ({ toolName, toolInput }) => window.__callscopeWebMcpTest.invoke(toolName, toolInput),
    { toolName: name, toolInput: input },
  )
}

test('completes the real WebMCP audio rescue with separate human approval', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await installModelContextDouble(page)
  await page.goto('./')

  await expect(page.getByTestId('webmcp-badge')).toContainText('ready')
  const registrations = await page.evaluate(() =>
    window.__callscopeWebMcpTest.registrations.map(({ tool, signal, active }) => ({
      name: tool.name,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      active,
      signalAborted: signal.aborted,
    })),
  )
  expect(registrations.map(({ name }) => name)).toEqual(TOOL_NAMES)
  expect(registrations.every(({ active, signalAborted }) => active && !signalAborted)).toBe(true)

  const idleContext = await invoke(page, 'get_lab_context')
  expect(idleContext).toMatchObject({
    ok: true,
    session_id: null,
    pending_plan_status: null,
    webmcp_supported: true,
  })

  await page.getByTestId('start-demo').click()
  await expect(page.getByTestId('health-status')).toContainText('Healthy', { timeout: 20_000 })
  await page.getByTestId('break-audio').click()
  await expect(page.getByTestId('audio-track-status')).toContainText('disabled')
  await expect(page.getByText('Failure snapshot captured').last()).toBeVisible()

  const context = await invoke(page, 'get_lab_context')
  const sessionId = context.session_id
  expect(context).toMatchObject({
    lab_state: 'critical',
    active_fault: 'disabled_audio',
    pending_plan_status: null,
    suggested_next_tools: ['inspect_call_state', 'run_call_diagnostics'],
  })

  const inspected = await invoke(page, 'inspect_call_state', {
    session_id: sessionId,
    detail: 'all',
  })
  expect(inspected).toMatchObject({
    ok: true,
    tracks: { audio: { ready_state: 'live', enabled: false, attached: true } },
    senders: { audio: { attached: true, max_bitrate_bps: null } },
    health: { status: 'critical', score: 55 },
  })

  const diagnosed = await invoke(page, 'run_call_diagnostics', {
    session_id: sessionId,
    symptom: 'silent_audio',
    sample_duration_ms: 1000,
  })
  expect(diagnosed).toMatchObject({
    ok: true,
    findings: [{
      code: 'OUTBOUND_AUDIO_TRACK_DISABLED',
      title: 'Outbound audio track is disabled',
      severity: 'critical',
      confidence: 'high',
      allowed_recovery_actions: ['enable_audio_track'],
    }],
    suggested_next_tools: ['stage_recovery_plan'],
  })

  const staged = await invoke(page, 'stage_recovery_plan', {
    session_id: sessionId,
    diagnosis_id: diagnosed.diagnosis_id,
    action: 'enable_audio_track',
    reason: 'The live outbound audio track is disabled while remaining live and attached.',
    expected_result: 'Restore audio transmission without replacing the sender.',
  })
  expect(staged).toMatchObject({
    ok: true,
    status: 'staged',
    approval_applies_repair: false,
  })
  await expect(page.getByTestId('recovery-plan')).toBeVisible()
  await expect(page.getByTestId('recovery-plan')).toContainText(
    'The live outbound audio track is disabled while remaining live and attached.',
  )

  const bypass = await invoke(page, 'apply_recovery_action', {
    session_id: sessionId,
    plan_id: staged.plan_id,
  })
  expect(bypass).toMatchObject({ ok: false, error: { code: 'PLAN_NOT_APPROVED' } })
  await expect(page.getByTestId('audio-track-status')).toContainText('disabled')

  await page.getByTestId('approve-recovery').click()
  await expect(page.getByTestId('approved-instruction')).toContainText(
    'Recovery approved. Tell the agent to continue.',
  )
  await expect(page.getByTestId('approved-instruction')).toContainText(
    'Approved. Apply the repair, verify recovery, and generate the report.',
  )
  await expect(page.getByTestId('audio-track-status')).toContainText('disabled')

  const approvedContext = await invoke(page, 'get_lab_context')
  expect(approvedContext).toMatchObject({
    pending_plan_id: staged.plan_id,
    pending_plan_status: 'approved',
    suggested_next_tools: ['apply_recovery_action'],
  })

  const applied = await invoke(page, 'apply_recovery_action', {
    session_id: sessionId,
    plan_id: staged.plan_id,
  })
  expect(applied).toMatchObject({
    ok: true,
    applied_action: 'enable_audio_track',
    previous_state: { enabled: false },
    new_state: { enabled: true },
    verification_pending: true,
    suggested_next_tools: ['compare_to_failure_baseline'],
  })
  await expect(page.getByTestId('audio-track-status')).toContainText('enabled')
  await expect(page.getByTestId('health-status')).toContainText('Verification pending')
  await expect(page.getByTestId('applied-instruction')).toContainText(
    'Recovery action applied. Verification is still pending.',
  )
  await expect(page.getByTestId('before-after')).toHaveCount(0)
  await expect(page.getByText('Recovery verification completed')).toHaveCount(0)
  await expect(page.getByTestId('incident-report')).toHaveCount(0)

  const compared = await invoke(page, 'compare_to_failure_baseline', {
    session_id: sessionId,
    plan_id: staged.plan_id,
    sample_duration_ms: 2000,
  })
  expect(compared).toMatchObject({
    ok: true,
    verdict: 'recovered',
    restored_states: {
      actual_track_changed_false_to_true: true,
      track_live_and_attached: true,
      both_peers_connected: true,
      fresh_audio_media_progression: true,
    },
    suggested_next_tools: ['generate_incident_report'],
  })
  await expect(page.getByTestId('before-after').locator('.verdict')).toHaveText('recovered')

  const report = await invoke(page, 'generate_incident_report', {
    session_id: sessionId,
    format: 'markdown',
  })
  expect(report).toMatchObject({
    ok: true,
    format: 'markdown',
    sections: {
      session_id: sessionId,
      root_cause: 'Outbound audio track is disabled',
      verification_result: { verdict: 'recovered' },
      sanitization: {
        raw_ip_addresses_excluded: true,
        sdp_excluded: true,
        device_labels_excluded: true,
      },
    },
    download_available: false,
  })
  expect(report.markdown).toContain('# CallScope Incident Report')
  expect(report.markdown).toContain('## Sanitized evidence')
  await expect(page.getByTestId('incident-report')).toBeVisible()

  const timelineToolNames = await page.locator('[data-testid="timeline"] h3').allTextContents()
  for (const toolName of TOOL_NAMES) expect(timelineToolNames).toContain(toolName)
  const chronologicalTimeline = (await page.locator('[data-testid="timeline"] li').allTextContents()).reverse()
  const heroOrder = [
    'run_call_diagnostics',
    'stage_recovery_plan',
    'Recovery approved',
    'apply_recovery_action',
    'compare_to_failure_baseline',
    'generate_incident_report',
  ]
  let previousHeroIndex = -1
  const heroIndexes = heroOrder.map((title) => {
    previousHeroIndex = chronologicalTimeline.findIndex(
      (event, index) => index > previousHeroIndex && event.includes(title),
    )
    return previousHeroIndex
  })
  expect(heroIndexes.every((index) => index >= 0)).toBe(true)
  expect(heroIndexes).toEqual([...heroIndexes].sort((left, right) => left - right))
  await expect(page.getByTestId('timeline')).toContainText('Agent')
  await expect(page.getByTestId('timeline')).toContainText('User')
  await expect(page.getByTestId('timeline')).toContainText('System')
  expect(errors).toEqual([])
})

test('returns stable schema and session errors without mutating media', async ({ page }) => {
  await installModelContextDouble(page)
  await page.goto('./')
  await page.getByTestId('start-demo').click()
  await expect(page.getByTestId('health-status')).toContainText('Healthy', { timeout: 20_000 })
  await page.getByTestId('break-audio').click()
  await expect(page.getByTestId('audio-track-status')).toContainText('disabled')
  await expect(page.getByText('Failure snapshot captured').last()).toBeVisible()

  const invalid = await invoke(page, 'run_call_diagnostics', {
    session_id: 'not-the-session',
    symptom: 'invented',
    actor: 'User',
  })
  expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_TOOL_INPUT' } })

  const mismatch = await invoke(page, 'inspect_call_state', {
    session_id: 'not-the-session',
  })
  expect(mismatch).toMatchObject({ ok: false, error: { code: 'SESSION_MISMATCH' } })
  await expect(page.getByTestId('audio-track-status')).toContainText('disabled')
  await expect(page.getByText('run_call_diagnostics').first()).toBeVisible()
  await expect(page.getByText('inspect_call_state').first()).toBeVisible()
})

test('cancelled diagnostic and comparison calls cannot write into replacement ownership', async ({ page }) => {
  await installModelContextDouble(page)
  await page.goto('./')
  await page.getByTestId('start-demo').click()
  await expect(page.getByTestId('health-status')).toContainText('Healthy', { timeout: 20_000 })
  await page.getByTestId('break-audio').click()
  await expect(page.getByTestId('audio-track-status')).toContainText('disabled')
  await expect(page.getByText('Failure snapshot captured').last()).toBeVisible()

  const firstContext = await invoke(page, 'get_lab_context')
  await page.evaluate(({ sessionId }) => {
    window.__cancelledDiagnostic = window.__callscopeWebMcpTest.invoke('run_call_diagnostics', {
      session_id: sessionId,
      symptom: 'silent_audio',
      sample_duration_ms: 2000,
    })
  }, { sessionId: firstContext.session_id })
  await expect(page.getByTestId('health-status')).toContainText('Diagnosing')
  await page.getByTestId('reset-scenario').click()
  await expect(page.getByTestId('health-status')).toContainText('Healthy', { timeout: 20_000 })
  expect(await page.evaluate(() => window.__cancelledDiagnostic)).toMatchObject({
    ok: false,
    error: { code: 'OPERATION_CANCELLED' },
  })
  expect(await page.locator('[data-testid="timeline"] h3').allTextContents())
    .not.toContain('run_call_diagnostics')

  const capturedBaselines = page.getByText('Failure snapshot captured')
  const baselineCount = await capturedBaselines.count()
  await page.getByTestId('break-audio').click()
  await expect(page.getByTestId('audio-track-status')).toContainText('disabled')
  await expect(capturedBaselines).toHaveCount(baselineCount + 1)
  const context = await invoke(page, 'get_lab_context')
  const diagnosis = await invoke(page, 'run_call_diagnostics', {
    session_id: context.session_id,
    symptom: 'silent_audio',
    sample_duration_ms: 1000,
  })
  const staged = await invoke(page, 'stage_recovery_plan', {
    session_id: context.session_id,
    diagnosis_id: diagnosis.diagnosis_id,
    action: 'enable_audio_track',
    reason: 'The actual outbound audio track is disabled.',
    expected_result: 'Restore outbound audio progression.',
  })
  await page.getByTestId('approve-recovery').click()
  await invoke(page, 'apply_recovery_action', {
    session_id: context.session_id,
    plan_id: staged.plan_id,
  })
  await expect(page.getByTestId('audio-track-status')).toContainText('enabled')

  await page.evaluate(({ sessionId, planId }) => {
    window.__cancelledComparison = window.__callscopeWebMcpTest.invoke(
      'compare_to_failure_baseline',
      {
        session_id: sessionId,
        plan_id: planId,
        sample_duration_ms: 2000,
      },
    )
  }, { sessionId: context.session_id, planId: staged.plan_id })
  await page.waitForTimeout(100)
  await page.getByTestId('end-reset').click()
  await expect(page.getByTestId('health-status')).toContainText('Ended')
  await page.getByTestId('end-reset').click()
  await page.getByTestId('start-demo').click()
  await expect(page.getByTestId('health-status')).toContainText('Healthy', { timeout: 20_000 })

  expect(await page.evaluate(() => window.__cancelledComparison)).toMatchObject({
    ok: false,
    error: { code: 'OPERATION_CANCELLED' },
  })
  expect(await page.locator('[data-testid="timeline"] h3').allTextContents())
    .not.toContain('compare_to_failure_baseline')
})
