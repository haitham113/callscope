import path from 'node:path'
import { expect, test } from '@playwright/test'

const screenshotsDirectory = path.join(process.cwd(), 'docs', 'screenshots')

async function capture(page, name) {
  await page.evaluate(() => {
    if (document.activeElement instanceof window.HTMLElement) document.activeElement.blur()
    if (!document.querySelector('#submission-capture-style')) {
      const style = document.createElement('style')
      style.id = 'submission-capture-style'
      style.textContent = '.skip-link{display:none!important}.topbar{position:relative!important}'
      document.head.append(style)
    }
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(100)
  await page.screenshot({
    path: path.join(screenshotsDirectory, name),
    fullPage: true,
  })
}

test('captures the four verified submission states from real browser media', async ({ page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.setViewportSize({ width: 1440, height: 1050 })
  await page.goto('./')
  await page.getByTestId('start-demo').click()
  await expect(page.getByTestId('health-status')).toContainText('Healthy', { timeout: 20_000 })
  await capture(page, '01-healthy.png')

  await page.getByTestId('break-audio').click()
  await expect(page.getByTestId('health-status')).toContainText('Critical')
  await page.getByTestId('diagnose-stage').click()
  await expect(page.getByTestId('recovery-plan')).toContainText('enable_audio_track')
  await capture(page, '02-staged-recovery.png')

  await page.getByTestId('approve-recovery').click()
  await expect(page.getByTestId('audio-track-status')).toContainText('disabled')
  await expect(page.getByTestId('approved-instruction')).toContainText('media is still broken')
  await capture(page, '03-approved-still-broken.png')

  await page.getByTestId('apply-manually').click()
  await expect(page.getByTestId('health-status')).toContainText('Healthy', { timeout: 20_000 })
  await expect(page.getByTestId('before-after')).toContainText('recovered')
  await expect(page.getByTestId('incident-report')).toBeVisible()
  await capture(page, '04-before-after-recovery.png')

  expect(errors).toEqual([])
})
