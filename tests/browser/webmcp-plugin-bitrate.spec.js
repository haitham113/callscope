import { chromium, expect, test } from '@playwright/test'

const TOOL_NAMES = [
  'get_lab_context',
  'inspect_call_state',
  'run_call_diagnostics',
  'stage_recovery_plan',
  'apply_recovery_action',
  'compare_to_failure_baseline',
  'generate_incident_report',
]

const extensionPath = process.env.CALLSCOPE_WEBMCP_EXTENSION_PATH
const userDataDir = process.env.CALLSCOPE_WEBMCP_USER_DATA_DIR

test('discovers all tools and runs both rescues through the installed WebMCP Inspector', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  test.skip(
    !extensionPath && !userDataDir,
    'Set CALLSCOPE_WEBMCP_EXTENSION_PATH or CALLSCOPE_WEBMCP_USER_DATA_DIR for the Inspector.',
  )
  test.setTimeout(120_000)

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
    const browserErrors = []
    page.on('pageerror', error => browserErrors.push(error.message))
    page.on('console', message => {
      if (message.type() === 'error') browserErrors.push(message.text())
    })
    await page.goto(testInfo.project.use.baseURL)
    await expect(page.getByTestId('webmcp-badge')).toContainText('ready')

    const extensionPage = await context.newPage()
    await extensionPage.goto(`chrome-extension://${extensionId}/sidebar.html`)
    const pageUrl = `${testInfo.project.use.baseURL}*`
    const discoveredTools = await extensionPage.evaluate(async (targetUrl) => {
      const tabs = await globalThis.chrome.tabs.query({ url: targetUrl })
      if (!tabs[0]?.id) throw new Error('CallScope tab was not visible to the Inspector.')
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => reject(new Error('Inspector tool discovery timed out.')), 10_000)
        const listener = (message, sender) => {
          if (sender.tab?.id !== tabs[0].id || !Array.isArray(message.tools)) return
          clearTimeout(timeoutId)
          globalThis.chrome.runtime.onMessage.removeListener(listener)
          resolve(message.tools)
        }
        globalThis.chrome.runtime.onMessage.addListener(listener)
        globalThis.chrome.tabs.sendMessage(
          tabs[0].id,
          { action: 'LIST_TOOLS', fromOrigins: [] },
          { frameId: 0 },
        ).catch(reject)
      })
    }, pageUrl)
    expect(discoveredTools.map(({ name }) => name).sort()).toEqual([...TOOL_NAMES].sort())

    async function invoke(name, input) {
      const raw = await extensionPage.evaluate(async ({ toolName, inputArgs, targetUrl }) => {
        const tabs = await globalThis.chrome.tabs.query({ url: targetUrl })
        if (!tabs[0]?.id) throw new Error('CallScope tab was not visible to the Inspector.')
        return globalThis.chrome.tabs.sendMessage(
          tabs[0].id,
          { action: 'EXECUTE_TOOL', name: toolName, inputArgs: JSON.stringify(inputArgs) },
          { frameId: 0 },
        )
      }, { toolName: name, inputArgs: input, targetUrl: pageUrl })
      return JSON.parse(raw)
    }

    await page.getByTestId('start-demo').click()
    await expect(page.getByTestId('health-status')).toContainText('Healthy', { timeout: 20_000 })

    await page.getByTestId('break-audio').click()
    await expect(page.getByText('Failure snapshot captured').last()).toBeVisible()
    const audioContext = await invoke('get_lab_context', {})
    expect(audioContext).toMatchObject({ active_fault: 'disabled_audio' })
    expect(await invoke('inspect_call_state', {
      detail: 'all',
    })).toMatchObject({ tracks: { audio: { enabled: false, ready_state: 'live', attached: true } } })
    const audioDiagnosis = await invoke('run_call_diagnostics', {
      symptom: 'silent_audio',
      sample_duration_ms: 1000,
    })
    const audioPlan = await invoke('stage_recovery_plan', {
      session_id: audioContext.session_id,
      diagnosis_id: audioDiagnosis.diagnosis_id,
      action: 'enable_audio_track',
      reason: 'The live outbound audio track is disabled while remaining attached.',
      expected_result: 'Restore audio transmission without replacing the sender.',
    })
    expect((await invoke('apply_recovery_action', {
      session_id: audioContext.session_id,
      plan_id: audioPlan.plan_id,
    })).error.code).toBe('PLAN_NOT_APPROVED')
    await page.getByTestId('approve-recovery').click()
    expect(await invoke('apply_recovery_action', {
      session_id: audioContext.session_id,
      plan_id: audioPlan.plan_id,
    })).toMatchObject({ applied_action: 'enable_audio_track', new_state: { enabled: true } })
    expect(await invoke('compare_to_failure_baseline', {
      session_id: audioContext.session_id,
      plan_id: audioPlan.plan_id,
      sample_duration_ms: 2000,
    })).toMatchObject({ verdict: 'recovered', restored_states: { fresh_audio_media_progression: true } })
    expect(await invoke('generate_incident_report', {
      session_id: audioContext.session_id,
      format: 'summary',
    })).toMatchObject({ sections: { approved_recovery: { action: 'enable_audio_track' } } })

    await expect(page.getByTestId('health-status')).toContainText('Healthy')
    await page.getByTestId('break-video-bitrate').click()
    await expect(page.getByText('Failure snapshot captured')).toHaveCount(2)
    await expect(page.getByTestId('health-status')).toContainText('Degraded')
    const bitrateContext = await invoke('get_lab_context', {})
    expect(bitrateContext).toMatchObject({ active_fault: 'constrained_video_bitrate' })
    expect(await invoke('inspect_call_state', {
      detail: 'all',
    })).toMatchObject({ senders: { video: { max_bitrate_bps: 80_000, bitrate_limited: true } } })
    const bitrateDiagnosis = await invoke('run_call_diagnostics', {
      symptom: 'poor_video',
      sample_duration_ms: 1000,
    })
    expect(bitrateDiagnosis).toMatchObject({ ok: true, diagnosis_id: expect.any(String) })
    const bitratePlan = await invoke('stage_recovery_plan', {
      session_id: bitrateContext.session_id,
      diagnosis_id: bitrateDiagnosis.diagnosis_id,
      action: 'restore_video_bitrate',
      reason: 'Restore the preserved known-good video encoding profile.',
      expected_result: 'Fresh sender readback confirms the profile restoration.',
    })
    expect(bitratePlan).toMatchObject({ ok: true, plan_id: expect.any(String), status: 'staged' })
    expect((await invoke('apply_recovery_action', {
      session_id: bitrateContext.session_id,
      plan_id: bitratePlan.plan_id,
    })).error.code).toBe('PLAN_NOT_APPROVED')
    await page.getByTestId('approve-recovery').click()
    expect(await invoke('apply_recovery_action', {
      session_id: bitrateContext.session_id,
      plan_id: bitratePlan.plan_id,
    })).toMatchObject({
      applied_action: 'restore_video_bitrate',
      new_state: { bitrate_limited: false, profile_restored: true },
    })
    expect(await invoke('compare_to_failure_baseline', {
      session_id: bitrateContext.session_id,
      plan_id: bitratePlan.plan_id,
      sample_duration_ms: 1000,
    })).toMatchObject({ verdict: 'recovered' })
    expect(await invoke('generate_incident_report', {
      session_id: bitrateContext.session_id,
      format: 'summary',
    })).toMatchObject({ sections: { approved_recovery: { action: 'restore_video_bitrate' } } })
    expect(browserErrors).toEqual([])
  } finally {
    await context.close()
  }
})
