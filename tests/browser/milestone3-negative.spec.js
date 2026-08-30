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
  await expect(page.getByTestId('health-status')).toContainText('Healthy', { timeout: 20_000 })
}

async function fault(page) {
  await page.getByTestId('break-audio').click()
  await expect(page.getByTestId('health-status')).toContainText('Critical')
  await expect(page.getByTestId('audio-track-status')).toContainText('disabled')
}

async function stage(page) {
  await page.getByTestId('diagnose-stage').click()
  await expect(page.getByTestId('recovery-plan')).toBeVisible()
}

test('unsupported media capability fails stably, cleans partial state, and can retry', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await page.addInitScript(() => {
    window.__nativeCaptureStream = window.HTMLCanvasElement.prototype.captureStream
    window.HTMLCanvasElement.prototype.captureStream = undefined
  })
  await page.goto('./')
  await page.getByTestId('start-demo').click()

  await expect(page.getByTestId('health-status')).toContainText('Failed')
  await expect(page.getByRole('alert')).toContainText('MEDIA_CAPABILITY_UNSUPPORTED')
  await expect(page.getByTestId('cleanup-receipt')).toContainText('All tracked browser resources released')

  await page.evaluate(() => {
    window.HTMLCanvasElement.prototype.captureStream = window.__nativeCaptureStream
  })
  await startHealthy(page)
  expect(errors).toEqual([])
})

test('partial peer startup reports and releases both real peer connections before retry', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await page.addInitScript(() => {
    const nativeSetRemoteDescription = window.RTCPeerConnection.prototype.setRemoteDescription
    let injectFailure = true
    window.RTCPeerConnection.prototype.setRemoteDescription = function injectedSetRemoteDescription(description) {
      if (injectFailure) {
        injectFailure = false
        return Promise.reject(new Error('Injected peer startup failure'))
      }
      return nativeSetRemoteDescription.call(this, description)
    }
  })
  await page.goto('./')
  await page.getByTestId('start-demo').click()

  await expect(page.getByTestId('health-status')).toContainText('Failed')
  await expect(page.getByRole('alert')).toContainText('LAB_START_FAILED')
  await expect(page.getByTestId('cleanup-receipt')).toContainText('Peers 2/2 closed')
  await expect(page.getByTestId('cleanup-receipt')).toContainText('All tracked browser resources released')

  await startHealthy(page)
  expect(errors).toEqual([])
})

test('an injected peer cleanup failure produces a real incomplete receipt and failed state', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await page.addInitScript(() => {
    const nativeClose = window.RTCPeerConnection.prototype.close
    let skippedOneClose = false
    window.RTCPeerConnection.prototype.close = function injectedClose() {
      if (!skippedOneClose) {
        skippedOneClose = true
        throw new Error('Injected close failure')
      }
      return nativeClose.call(this)
    }
  })
  await page.goto('./')
  await startHealthy(page)
  await page.getByTestId('end-reset').click()

  await expect(page.getByTestId('health-status')).toContainText('Failed')
  await expect(page.getByRole('alert')).toContainText('CLEANUP_INCOMPLETE')
  await expect(page.getByTestId('cleanup-receipt')).toContainText('Cleanup needs attention')
  await expect(page.getByTestId('cleanup-receipt')).toContainText('Peers 1/2 closed')
  await expect(page.getByTestId('start-demo')).toHaveCount(0)

  await page.getByTestId('end-reset').click()
  await expect(page.getByTestId('health-status')).toContainText('Ended')
  await expect(page.getByTestId('cleanup-receipt')).toContainText('All tracked browser resources released')
  await startHealthy(page)
  expect(errors).toEqual([])
})

test('scenario reset cancels a real diagnostic window without a late plan', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await page.goto('./')
  await startHealthy(page)
  await fault(page)

  await page.getByTestId('diagnose-stage').click({ noWaitAfter: true })
  await expect(page.getByTestId('health-status')).toContainText('Diagnosing')
  await page.getByTestId('reset-scenario').click()
  await expect(page.getByTestId('health-status')).toContainText('Healthy')
  await expect(page.getByTestId('audio-track-status')).toContainText('enabled')
  await page.waitForTimeout(1500)
  await expect(page.getByTestId('recovery-plan')).toHaveCount(0)
  await expect(page.getByTestId('health-status')).toContainText('Healthy')
  expect(errors).toEqual([])
})

test('scenario reset cancels real recovery verification with no late report', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await page.goto('./')
  await startHealthy(page)
  await fault(page)
  await stage(page)
  await page.getByTestId('approve-recovery').click()

  await page.getByTestId('apply-manually').click({ noWaitAfter: true })
  await expect(page.getByTestId('health-status')).toContainText('Recovering')
  await page.getByTestId('reset-scenario').click()
  await expect(page.getByTestId('health-status')).toContainText('Healthy')
  await page.waitForTimeout(1500)
  await expect(page.getByTestId('before-after')).toHaveCount(0)
  await expect(page.getByTestId('incident-report')).toHaveCount(0)
  await expect(page.getByTestId('recovery-plan')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('end cancels diagnosis and verification without late mutation of a restarted session', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await page.goto('./')
  await startHealthy(page)
  await fault(page)
  await page.getByTestId('diagnose-stage').click({ noWaitAfter: true })
  await expect(page.getByTestId('health-status')).toContainText('Diagnosing')
  await page.getByTestId('end-reset').click()
  await expect(page.getByTestId('health-status')).toContainText('Ended')
  await page.waitForTimeout(1300)

  await page.getByTestId('end-reset').click()
  await startHealthy(page)
  await fault(page)
  await stage(page)
  await page.getByTestId('approve-recovery').click()
  await page.getByTestId('apply-manually').click({ noWaitAfter: true })
  await expect(page.getByTestId('health-status')).toContainText('Recovering')
  await page.getByTestId('end-reset').click()
  await expect(page.getByTestId('health-status')).toContainText('Ended')
  await page.waitForTimeout(1500)
  await expect(page.getByTestId('health-status')).toContainText('Ended')
  await expect(page.getByTestId('cleanup-receipt')).toContainText('All tracked browser resources released')
  expect(errors).toEqual([])
})

test('the UI suppresses duplicate diagnosis commands and keeps pre-approval apply unavailable', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await page.goto('./')
  await startHealthy(page)
  await fault(page)
  await expect(page.getByTestId('apply-manually')).toHaveCount(0)

  await page.getByTestId('diagnose-stage').click({ noWaitAfter: true })
  await expect(page.getByTestId('diagnose-stage')).toBeDisabled()
  await expect(page.getByTestId('recovery-plan')).toBeVisible()
  await expect(page.getByText('Recovery plan staged')).toHaveCount(1)
  await expect(page.getByTestId('apply-manually')).toHaveCount(0)
  await expect(page.getByTestId('audio-track-status')).toContainText('disabled')
  expect(errors).toEqual([])
})
