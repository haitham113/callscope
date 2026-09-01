import { expect, test } from '@playwright/test'

async function startHealthy(page) {
  await page.goto('./')
  await page.getByTestId('start-demo').click()
  await expect(page.getByTestId('health-status')).toContainText('Healthy', { timeout: 20_000 })
}

test('presents a readable operations hierarchy and unsupported fallback', async ({ page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto('./')

  await expect(page.getByRole('heading', { name: 'See the call. Prove the health.' })).toBeVisible()
  await expect(page.getByTestId('workflow-strip')).toContainText('Observe')
  await expect(page.getByTestId('workflow-strip')).toContainText('Approve')
  await expect(page.getByTestId('webmcp-fallback')).toContainText('manual rescue remains fully available')
  await expect(page.getByTestId('health-status')).toHaveAttribute('aria-live', 'polite')

  const healthSize = await page.getByTestId('health-status').locator('strong').evaluate((node) =>
    Number.parseFloat(window.getComputedStyle(node).fontSize),
  )
  expect(healthSize).toBeGreaterThanOrEqual(36)
  expect(errors).toEqual([])
})

test('keeps approval separate, deliberate, and keyboard operable', async ({ page }) => {
  await startHealthy(page)
  await page.getByTestId('break-audio').click()
  await page.getByTestId('diagnose-stage').click()
  await expect(page.getByTestId('recovery-plan')).toContainText('Approval records consent only')

  await page.getByTestId('approve-recovery').focus()
  const approveFocus = await page.getByTestId('approve-recovery').evaluate((node) =>
    window.getComputedStyle(node).outlineStyle,
  )
  expect(approveFocus).not.toBe('none')

  await page.keyboard.press('Enter')
  await expect(page.getByTestId('health-status')).toContainText('Critical')
  await expect(page.getByTestId('audio-track-status')).toContainText('disabled')
  await expect(page.getByTestId('approved-instruction')).toContainText(
    'Approved. Apply the repair, verify recovery, and generate the report.',
  )
  await expect(page.getByTestId('manual-fallback')).toContainText('No agent available?')
})

for (const viewport of [
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`uses a functional stacked ${viewport.name} layout without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('./')

    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth)
    await expect(page.getByTestId('webmcp-badge')).toBeVisible()
    await expect(page.getByTestId('start-demo')).toBeVisible()
  })
}

test('honors reduced motion while preserving status visibility', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('./')

  const transitionDuration = await page.getByTestId('health-status').evaluate((node) =>
    window.getComputedStyle(node).transitionDuration,
  )
  expect(['0s', '0.001s', '0.01ms']).toContain(transitionDuration)
  await expect(page.getByTestId('health-status')).toBeVisible()
})
