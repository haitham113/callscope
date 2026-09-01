import { chromium, expect, test } from '@playwright/test'

const extensionPath = process.env.CALLSCOPE_WEBMCP_EXTENSION_PATH
const userDataDir = process.env.CALLSCOPE_WEBMCP_USER_DATA_DIR

test('runs the bitrate rescue through the installed WebMCP Inspector message path', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  test.skip(
    !extensionPath && !userDataDir,
    'Set CALLSCOPE_WEBMCP_EXTENSION_PATH or CALLSCOPE_WEBMCP_USER_DATA_DIR for the Inspector.',
  )
  test.setTimeout(60_000)

  const extensionId = process.env.CALLSCOPE_WEBMCP_EXTENSION_ID ??
    extensionPath?.split('/').at(-2) ??
    'gbpdfapgefenggkahomfgkhfehlcenpd'
  const extensionArguments = extensionPath && !userDataDir
    ? [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ]
    : ['--profile-directory=Default']
  const context = await chromium.launchPersistentContext(
    userDataDir ?? testInfo.outputPath('chrome-profile'),
    {
      channel: 'chrome',
      headless: false,
      env: { ...process.env, XDG_SESSION_TYPE: 'x11', QT_QPA_PLATFORM: 'xcb' },
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        ...extensionArguments,
        '--enable-features=WebMCPTesting',
        '--enable-webmcp-testing',
      ],
    },
  )

  try {
    const page = await context.newPage()
    await page.goto(testInfo.project.use.baseURL)
    await expect(page.getByTestId('webmcp-badge')).toContainText('ready')
    await page.getByTestId('start-demo').click()
    await expect(page.getByTestId('health-status')).toContainText('Healthy', { timeout: 20_000 })
    await page.getByTestId('break-video-bitrate').click()
    await expect(page.getByText('Failure snapshot captured').last()).toBeVisible()

    const extensionPage = await context.newPage()
    await extensionPage.goto(`chrome-extension://${extensionId}/sidebar.html`)
    async function invoke(name, input) {
      const raw = await extensionPage.evaluate(async ({ toolName, inputArgs, pageUrl }) => {
        const tabs = await globalThis.chrome.tabs.query({ url: pageUrl })
        if (!tabs[0]?.id) throw new Error('CallScope tab was not visible to the Inspector.')
        return globalThis.chrome.tabs.sendMessage(
          tabs[0].id,
          { action: 'EXECUTE_TOOL', name: toolName, inputArgs: JSON.stringify(inputArgs) },
          { frameId: 0 },
        )
      }, { toolName: name, inputArgs: input, pageUrl: `${testInfo.project.use.baseURL}*` })
      return JSON.parse(raw)
    }

    const contextResult = await invoke('get_lab_context', {})
    const sessionId = contextResult.session_id
    expect(contextResult).toMatchObject({ active_fault: 'constrained_video_bitrate' })

    const diagnosis = await invoke('run_call_diagnostics', {
      session_id: sessionId,
      symptom: 'poor_video',
      sample_duration_ms: 1000,
    })
    const plan = await invoke('stage_recovery_plan', {
      session_id: sessionId,
      diagnosis_id: diagnosis.diagnosis_id,
      action: 'restore_video_bitrate',
      reason: 'Restore the preserved known-good video encoding profile.',
      expected_result: 'Fresh sender readback confirms the profile restoration.',
    })
    expect((await invoke('apply_recovery_action', {
      session_id: sessionId,
      plan_id: plan.plan_id,
    })).error.code).toBe('PLAN_NOT_APPROVED')

    await page.getByTestId('approve-recovery').click()
    expect(await invoke('apply_recovery_action', {
      session_id: sessionId,
      plan_id: plan.plan_id,
    })).toMatchObject({
      applied_action: 'restore_video_bitrate',
      new_state: { bitrate_limited: false, profile_restored: true },
    })
    expect(await invoke('compare_to_failure_baseline', {
      session_id: sessionId,
      plan_id: plan.plan_id,
      sample_duration_ms: 1000,
    })).toMatchObject({ verdict: 'recovered' })
    expect(await invoke('generate_incident_report', {
      session_id: sessionId,
      format: 'summary',
    })).toMatchObject({
      sections: { approved_recovery: { action: 'restore_video_bitrate' } },
    })
  } finally {
    await context.close()
  }
})
