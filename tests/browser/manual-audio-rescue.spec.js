import { expect, test } from '@playwright/test'

function collectBrowserErrors(page) {
  const errors = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  return errors
}

async function startHealthy(page) {
  await page.getByTestId('start-demo').click()
  await expect(page.getByTestId('health-status')).toContainText('Healthy', {
    timeout: 20_000,
  })
  await expect(page.getByTestId('audio-track-status')).toContainText('enabled')
}

async function introduceAudioFault(page) {
  await page.getByTestId('break-audio').click()
  await expect(page.getByTestId('health-status')).toContainText('Critical')
  await expect(page.getByTestId('audio-track-status')).toContainText('disabled')
  await expect(page.getByText('Failure snapshot captured').last()).toBeVisible()
}

async function stagePlan(page) {
  await page.getByTestId('diagnose-stage').click()
  const plan = page.getByTestId('recovery-plan')
  await expect(plan).toBeVisible()
  await expect(plan).toContainText('Outbound audio track is disabled')
  await expect(plan).toContainText('critical severity')
  await expect(plan).toContainText('high confidence')
  await expect(plan).toContainText('tracks.audio.enabled = false')
  await expect(plan).toContainText('enable_audio_track')
  await expect(plan).toContainText('Risk low')
  await expect(plan).toContainText('Reversible yes')
}

async function approveAndApply(page) {
  await page.getByTestId('approve-recovery').click()
  await expect(page.getByTestId('approved-instruction')).toContainText(
    'Recovery approved. Tell the agent to continue.',
  )
  await expect(page.getByTestId('approved-instruction')).toContainText(
    'Approved. Apply the repair, verify recovery, and generate the report.',
  )
  await expect(page.getByTestId('audio-track-status')).toContainText('disabled')
  await page.getByTestId('apply-manually').click()
  await expect(page.getByTestId('before-after')).toContainText('recovered', {
    timeout: 12_000,
  })
  await expect(page.getByTestId('health-status')).toContainText('Healthy')
  await expect(page.getByTestId('audio-track-status')).toContainText('enabled')
  await expect(page.getByTestId('before-after')).toContainText('Audio enabled: false')
  await expect(page.getByTestId('before-after')).toContainText('Audio enabled: true')
  await expect(page.getByTestId('before-after')).toContainText('Fresh audio progression: confirmed')
  await expect(page.getByTestId('incident-report')).toContainText('Outbound audio track is disabled')
  await expect(page.getByTestId('incident-report')).toContainText(
    'raw IP addresses, SDP, and device labels excluded',
  )
}

test('completes the real manual disabled-audio rescue with authoritative verification', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await page.goto('./')
  await startHealthy(page)
  await introduceAudioFault(page)
  await stagePlan(page)

  await expect(page.getByTestId('apply-manually')).toHaveCount(0)
  await page.waitForTimeout(1200)
  await expect(page.getByTestId('audio-track-status')).toContainText('disabled')

  await approveAndApply(page)
  await expect(page.getByTestId('before-after').locator('.verification-checks li.passed')).toHaveCount(4)
  await expect(page.getByTestId('timeline')).toContainText('User')
  await expect(page.getByTestId('timeline')).toContainText('System')
  await expect(page.getByText('Recovery approved')).toBeVisible()
  await expect(page.getByText('Approved recovery applied')).toBeVisible()
  await expect(page.getByText('Recovery verification completed')).toBeVisible()
  await expect(page.getByText('Incident report generated')).toBeVisible()
  expect(errors).toEqual([])
})

test('rejection cannot mutate audio and Reset scenario restores actual healthy behavior', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await page.goto('./')
  await startHealthy(page)
  await introduceAudioFault(page)
  await stagePlan(page)
  await page.getByTestId('reject-recovery').click()
  await expect(page.getByTestId('recovery-plan')).toContainText('rejected')
  await expect(page.getByTestId('apply-manually')).toHaveCount(0)
  await expect(page.getByTestId('audio-track-status')).toContainText('disabled')

  await page.getByTestId('reset-scenario').click()
  await expect(page.getByTestId('health-status')).toContainText('Healthy')
  await expect(page.getByTestId('audio-track-status')).toContainText('enabled')
  await expect(page.getByText('Scenario reset to healthy')).toBeVisible()
  await expect(page.getByTestId('recovery-plan')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('rehearses the hero rescue three times in one real browser session', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await page.goto('./')
  await startHealthy(page)

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await introduceAudioFault(page)
    await stagePlan(page)
    await approveAndApply(page)
  }

  await expect(page.getByText('Incident report generated')).toHaveCount(3)
  expect(errors).toEqual([])
})
