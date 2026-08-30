import { expect, test } from '@playwright/test'

function collectBrowserErrors(page) {
  const errors = []
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  return errors
}

async function startAndExpectHealthy(page) {
  await page.getByTestId('start-demo').click()
  await expect(page.getByTestId('health-status')).toContainText('Healthy', {
    timeout: 20_000,
  })
  const progressGate = page
    .locator('.evidence-list li')
    .filter({ hasText: 'bidirectional audio video progress' })
  await expect(progressGate).toBeVisible()
  await expect(progressGate).toHaveClass(/passed/)
  await expect
    .poll(() =>
      page.getByTestId('remote-video').evaluate((video) => ({
        readyState: video.readyState,
        hasDecodedFrame: video.videoWidth > 0 && video.videoHeight > 0,
      })),
    )
    .toMatchObject({ readyState: 4, hasDecodedFrame: true })
  await expect(page.getByText('Unavailable', { exact: true })).toHaveCount(0)
}

test('loads the judge-facing shell without WebMCP and keeps manual start available', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'See the call. Prove the health.' })).toBeVisible()
  await expect(page.getByTestId('webmcp-badge')).toContainText('not detected')
  await expect(page.getByTestId('start-demo')).toBeEnabled()
  expect(errors).toEqual([])
})

test('reaches Healthy only from real connected media evidence', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await page.goto('/')
  await startAndExpectHealthy(page)
  await expect(page.getByText('Healthy baseline captured')).toBeVisible()
  await expect(page.getByText('Outbound peer').locator('..')).toContainText('connected')
  await expect(page.getByText('Inbound peer').locator('..')).toContainText('connected')
  expect(errors).toEqual([])
})

test('stops cleanly and restarts repeatedly without mocked peer connections', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await page.goto('/')

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await startAndExpectHealthy(page)
    await page.getByTestId('end-reset').click()
    await expect(page.getByTestId('health-status')).toContainText('Ended')
    const receipt = page.getByTestId('cleanup-receipt')
    await expect(receipt).toContainText('All tracked browser resources released')
    await expect(receipt).toContainText('Peers 2/2 closed')
    await expect(receipt).toContainText('Generated tracks 2/2 ended')
    await expect(receipt).toContainText('Remote tracks 2/2 ended')
    await expect(receipt).toContainText('AudioContext closed')
    await expect(receipt).toContainText('Sampler stopped')
    await expect(receipt).toContainText('Animation stopped')
  }

  expect(errors).toEqual([])
})

test('ending during startup cancels partial resources without late health mutation', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await page.goto('/')
  await page.getByTestId('start-demo').click({ noWaitAfter: true })
  await page.getByTestId('end-reset').click()
  await expect(page.getByTestId('health-status')).toContainText('Ended')
  await expect(page.getByTestId('cleanup-receipt')).toContainText(
    'All tracked browser resources released',
  )
  await page.waitForTimeout(1500)
  await expect(page.getByTestId('health-status')).toContainText('Ended')
  expect(errors).toEqual([])
})

test('cleans media created before a partial startup failure and then restarts', async ({ page }) => {
  const errors = collectBrowserErrors(page)
  await page.addInitScript(() => {
    const resources = (window.__partialStartupResources = {
      audioContexts: [],
      animationFrames: new Set(),
    })
    const NativeAudioContext = window.AudioContext
    window.AudioContext = class extends NativeAudioContext {
      constructor(...args) {
        super(...args)
        resources.audioContexts.push(this)
      }
    }

    const nativeRequestAnimationFrame = window.requestAnimationFrame
    const nativeCancelAnimationFrame = window.cancelAnimationFrame
    window.requestAnimationFrame = (callback) => {
      let animationFrameId
      animationFrameId = nativeRequestAnimationFrame((timestamp) => {
        resources.animationFrames.delete(animationFrameId)
        callback(timestamp)
      })
      resources.animationFrames.add(animationFrameId)
      return animationFrameId
    }
    window.cancelAnimationFrame = (animationFrameId) => {
      resources.animationFrames.delete(animationFrameId)
      return nativeCancelAnimationFrame(animationFrameId)
    }

    const nativeCaptureStream = window.HTMLCanvasElement.prototype.captureStream
    window.HTMLCanvasElement.prototype.captureStream = function captureStreamOnce() {
      window.HTMLCanvasElement.prototype.captureStream = nativeCaptureStream
      throw new Error('Injected captureStream startup failure')
    }
  })
  await page.goto('/')

  await page.getByTestId('start-demo').click()
  await expect(page.getByTestId('health-status')).toContainText('Failed')
  const failureReceipt = page.getByTestId('cleanup-receipt')
  await expect(failureReceipt).toContainText('All tracked browser resources released')
  await expect(failureReceipt).toContainText('Generated tracks 1/1 ended')
  await expect(failureReceipt).toContainText('AudioContext closed')
  await expect(failureReceipt).toContainText('Animation stopped')
  await expect
    .poll(() =>
      page.evaluate(() => ({
        activeAudioContexts: window.__partialStartupResources.audioContexts.filter(
          (context) => context.state !== 'closed',
        ).length,
        activeAnimationFrames:
          window.__partialStartupResources.animationFrames.size,
      })),
    )
    .toEqual({ activeAudioContexts: 0, activeAnimationFrames: 0 })

  await startAndExpectHealthy(page)
  await page.getByTestId('end-reset').click()
  await expect(page.getByTestId('health-status')).toContainText('Ended')
  await expect
    .poll(() =>
      page.evaluate(() => ({
        contextStates: window.__partialStartupResources.audioContexts.map(
          (context) => context.state,
        ),
        activeAnimationFrames:
          window.__partialStartupResources.animationFrames.size,
      })),
    )
    .toEqual({ contextStates: ['closed', 'closed'], activeAnimationFrames: 0 })
  expect(errors).toEqual([])
})
