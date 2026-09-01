import { expect, test } from '@playwright/test'

test('records three repeatable judge-path rehearsal times without browser errors', async ({ page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto('./')
  const startBeganAt = Date.now()
  await page.getByTestId('start-demo').click()
  await expect(page.getByTestId('health-status')).toContainText('Healthy', { timeout: 20_000 })
  const startToHealthyMs = Date.now() - startBeganAt
  const recoveryTimesMs = []

  for (let cycle = 0; cycle < 3; cycle += 1) {
    const reportEvents = page.getByText('Incident report generated')
    const reportCount = await reportEvents.count()
    const cycleBeganAt = Date.now()

    await page.getByTestId('break-audio').click()
    await expect(page.getByTestId('health-status')).toContainText('Critical')
    await page.getByTestId('diagnose-stage').click()
    await expect(page.getByTestId('recovery-plan')).toContainText('enable_audio_track')
    await page.getByTestId('approve-recovery').click()
    await expect(page.getByTestId('audio-track-status')).toContainText('disabled')
    await page.getByTestId('apply-manually').click()
    await expect(page.getByTestId('health-status')).toContainText('Healthy', { timeout: 20_000 })
    await expect(page.getByTestId('before-after')).toContainText('recovered')
    await expect(reportEvents).toHaveCount(reportCount + 1)

    recoveryTimesMs.push(Date.now() - cycleBeganAt)
  }

  process.stdout.write(`REHEARSAL_TIMES ${JSON.stringify({ startToHealthyMs, recoveryTimesMs })}\n`)
  expect(recoveryTimesMs.every((elapsed) => elapsed < 120_000)).toBe(true)
  expect(errors).toEqual([])
})
