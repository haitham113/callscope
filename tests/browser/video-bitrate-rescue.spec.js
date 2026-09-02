import { expect, test } from '@playwright/test'

async function startHealthy(page) {
  await page.goto('./')
  await page.getByTestId('start-demo').click()
  await expect(page.getByTestId('health-status')).toContainText('Healthy', { timeout: 20_000 })
}

async function installModelContextDouble(page) {
  await page.addInitScript(() => {
    const registrations = []
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        async registerTool(tool, { signal }) {
          registrations.push({ tool, signal })
        },
      },
    })
    window.__bitrateWebMcp = {
      registrations,
      invoke(name, input) {
        const registration = registrations.find((item) => item.tool.name === name)
        if (!registration || registration.signal.aborted) throw new Error(`Inactive tool: ${name}`)
        return registration.tool.execute(input)
      },
    }
  })
}

function invoke(page, name, input = {}) {
  return page.evaluate(
    ({ toolName, toolInput }) => window.__bitrateWebMcp.invoke(toolName, toolInput),
    { toolName: name, toolInput: input },
  )
}

function latestTimelineEvent(page, title) {
  return page.getByTestId('timeline').locator('li').filter({ hasText: title }).first()
}

test('keeps diagnosis and rejected-recovery timeline copy isolated by scenario', async ({ page }) => {
  await startHealthy(page)

  await page.getByTestId('break-audio').click()
  await expect(page.getByTestId('health-status')).toContainText('Critical')
  await page.getByTestId('diagnose-stage').click()
  const audioDiagnosis = latestTimelineEvent(page, 'Manual diagnosis requested')
  await expect(audioDiagnosis).toContainText('active disabled-audio fault')
  await expect(audioDiagnosis).not.toContainText('video-bitrate')
  await page.getByTestId('reject-recovery').click()
  const audioRejection = latestTimelineEvent(page, 'Recovery rejected')
  await expect(audioRejection).toContainText('outbound audio track remains disabled')
  await expect(audioRejection).not.toContainText('video bitrate')

  await page.getByTestId('reset-scenario').click()
  await expect(page.getByTestId('health-status')).toContainText('Healthy', { timeout: 20_000 })
  await page.getByTestId('break-video-bitrate').click()
  await expect(page.getByTestId('health-status')).toContainText('Degraded')
  await page.getByTestId('diagnose-stage').click()
  const videoDiagnosis = latestTimelineEvent(page, 'Manual diagnosis requested')
  await expect(videoDiagnosis).toContainText('active constrained-video-bitrate fault')
  await expect(videoDiagnosis).not.toContainText('disabled-audio')
  await page.getByTestId('reject-recovery').click()
  const videoRejection = latestTimelineEvent(page, 'Recovery rejected')
  await expect(videoRejection).toContainText('outbound video bitrate cap remains active')
  await expect(videoRejection).not.toContainText('audio track')
  await expect(videoRejection).not.toContainText('media track remains disabled')
})

test('completes the real manual video-bitrate rescue from sender readback', async ({ page }) => {
  await startHealthy(page)

  await page.getByTestId('break-video-bitrate').click()
  await expect(page.getByTestId('health-status')).toContainText('Degraded')
  await expect(page.getByTestId('video-sender-status')).toContainText('80,000 bps cap confirmed')

  await page.getByTestId('diagnose-stage').click()
  await expect(page.getByTestId('recovery-plan')).toContainText('restore_video_bitrate')
  await page.getByTestId('approve-recovery').click()
  await page.getByTestId('apply-manually').click()
  await expect(page.getByTestId('health-status')).toContainText('Verification pending')
  await page.getByTestId('verify-manually').click()

  await expect(page.getByTestId('health-status')).toContainText('Healthy', { timeout: 20_000 })
  await expect(page.getByTestId('before-after')).toContainText('sender cap removed')
  await expect(page.getByTestId('before-after')).toContainText('Known-good profile restored: true')
  await expect(page.getByTestId('video-sender-status')).toContainText('Known-good profile confirmed')
  await expect(page.getByTestId('before-after')).toContainText('supporting evidence only')
})

test('requires an explicit healthy reset before switching fault scenarios', async ({ page }) => {
  await startHealthy(page)

  await page.getByTestId('break-audio').click()
  await expect(page.getByTestId('health-status')).toContainText('Critical')
  await expect(page.getByTestId('break-video-bitrate')).toBeDisabled()
  await page.getByTestId('reset-scenario').click()
  await expect(page.getByTestId('health-status')).toContainText('Healthy', { timeout: 20_000 })

  await page.getByTestId('break-video-bitrate').click()
  await expect(page.getByTestId('health-status')).toContainText('Degraded')
  await expect(page.getByTestId('break-audio')).toBeDisabled()
  await page.getByTestId('reset-scenario').click()
  await expect(page.getByTestId('health-status')).toContainText('Healthy', { timeout: 20_000 })
  await expect(page.getByTestId('timeline')).toContainText('Scenario reset to healthy')
})

test('repeats the real bitrate fault and approved recovery three times', async ({ page }) => {
  await startHealthy(page)

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await page.getByTestId('break-video-bitrate').click()
    await expect(page.getByTestId('video-sender-status')).toContainText('80,000 bps cap confirmed')
    await page.getByTestId('diagnose-stage').click()
    await page.getByTestId('approve-recovery').click()
    await page.getByTestId('apply-manually').click()
    await expect(page.getByTestId('health-status')).toContainText('Verification pending')
    await page.getByTestId('verify-manually').click()
    await expect(page.getByTestId('health-status')).toContainText('Healthy', { timeout: 20_000 })
    await expect(page.getByTestId('video-sender-status')).toContainText('Known-good profile confirmed')
  }
})

test('completes the bitrate recovery through registered WebMCP tools after human-only approval', async ({ page }) => {
  await installModelContextDouble(page)
  await startHealthy(page)
  await expect(page.getByTestId('webmcp-badge')).toContainText('ready')
  await page.getByTestId('break-video-bitrate').click()
  await expect(page.getByText('Failure snapshot captured').last()).toBeVisible()

  const context = await invoke(page, 'get_lab_context')
  const sessionId = context.session_id
  expect(context).toMatchObject({ lab_state: 'degraded', active_fault: 'constrained_video_bitrate' })

  const inspected = await invoke(page, 'inspect_call_state', {
    session_id: sessionId,
    detail: 'all',
  })
  expect(inspected).toMatchObject({
    health: { status: 'degraded' },
    senders: { video: { max_bitrate_bps: 80_000, bitrate_limited: true, readback_confirmed: true } },
  })
  expect(inspected.selected_candidate).toMatchObject({
    type: expect.any(String), protocol: expect.any(String), path: expect.stringMatching(/direct|relayed/),
  })
  expect(JSON.stringify(inspected)).not.toMatch(/(?:\d{1,3}\.){3}\d{1,3}/)

  const diagnosed = await invoke(page, 'run_call_diagnostics', {
    session_id: sessionId,
    symptom: 'poor_video',
    sample_duration_ms: 1000,
  })
  expect(diagnosed).toMatchObject({
    findings: [{
      code: 'VIDEO_SENDER_BITRATE_CONSTRAINED',
      allowed_recovery_actions: ['restore_video_bitrate'],
    }],
  })
  expect(diagnosed.limitations).toContain(
    'Measured bitrate and frame rate are supporting evidence only and may be unavailable or unchanged in a local loopback.',
  )

  const staged = await invoke(page, 'stage_recovery_plan', {
    session_id: sessionId,
    diagnosis_id: diagnosed.diagnosis_id,
    action: 'restore_video_bitrate',
    reason: 'Restore the preserved known-good video encoding profile.',
    expected_result: 'Fresh sender readback confirms removal of the cap.',
  })
  expect((await invoke(page, 'apply_recovery_action', {
    session_id: sessionId,
    plan_id: staged.plan_id,
  })).error.code).toBe('PLAN_NOT_APPROVED')

  await page.getByTestId('approve-recovery').click()
  const applied = await invoke(page, 'apply_recovery_action', {
    session_id: sessionId,
    plan_id: staged.plan_id,
  })
  expect(applied).toMatchObject({
    ok: true,
    applied_action: 'restore_video_bitrate',
    previous_state: { bitrate_limited: true },
    new_state: { bitrate_limited: false, readback_confirmed: true },
  })

  const compared = await invoke(page, 'compare_to_failure_baseline', {
    session_id: sessionId,
    plan_id: staged.plan_id,
    sample_duration_ms: 1000,
  })
  expect(compared).toMatchObject({
    verdict: 'recovered',
    restored_states: {
      sender_cap_removed: true,
      known_good_profile_readback_confirmed: true,
    },
  })
  expect(compared.limitations).toContain('Sender-parameter readback is primary verification evidence.')

  const report = await invoke(page, 'generate_incident_report', {
    session_id: sessionId,
    format: 'summary',
  })
  expect(report).toMatchObject({
    ok: true,
    sections: {
      root_cause: 'Outbound video sender bitrate is constrained',
      approved_recovery: { action: 'restore_video_bitrate' },
      verification_result: { verdict: 'recovered' },
    },
  })
})
