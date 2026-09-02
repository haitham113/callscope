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

    if (viewport.name === 'mobile') {
      await page.getByTestId('start-demo').click()
      await expect(page.getByTestId('health-status')).toContainText('Healthy', { timeout: 20_000 })
      await page.getByTestId('break-audio').click()
      await page.getByTestId('diagnose-stage').click()
      await page.getByTestId('approve-recovery').click()
      await expect(page.getByTestId('approved-instruction')).toBeVisible()
      await page.getByTestId('apply-manually').click()
      await page.getByTestId('verify-manually').click()
      await expect(page.getByTestId('before-after').locator('.verdict')).toHaveText('recovered')
      await page.getByTestId('generate-report-manually').click()
      await expect(page.getByTestId('incident-report')).toBeVisible()
      const recoveredDimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(recoveredDimensions.scrollWidth).toBeLessThanOrEqual(recoveredDimensions.clientWidth)
    }
  })
}

test('keeps visible judge-facing text above WCAG AA contrast across workflow states', async ({ page }) => {
  async function auditVisibleText(state) {
    const result = await page.locator('body *').evaluateAll((nodes) => {
      function parseColor(value) {
        const channels = value.match(/[\d.]+/g)?.map(Number) ?? []
        return [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0, channels[3] ?? 1]
      }
      function composite(foreground, background) {
        const alpha = foreground[3] + background[3] * (1 - foreground[3])
        if (alpha === 0) return [0, 0, 0, 0]
        return [
          (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
          (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
          (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
          alpha,
        ]
      }
      function solidBackground(node) {
        const layers = []
        for (let current = node; current; current = current.parentElement) {
          layers.push(parseColor(window.getComputedStyle(current).backgroundColor))
        }
        return layers.reverse().reduce((background, layer) => composite(layer, background), [0, 0, 0, 0])
      }
      function effectiveBackgrounds(node) {
        const background = solidBackground(node)
        for (let current = node; current; current = current.parentElement) {
          const style = window.getComputedStyle(current)
          const image = style.backgroundImage
          if (image === 'none') {
            if (parseColor(style.backgroundColor)[3] === 1) return [background]
            continue
          }
          const stops = (image.match(/rgba?\([^)]+\)/g) ?? []).map(parseColor)
          if (!stops.length) return [background]
          const candidates = stops.map(stop => composite(stop, background))
          return stops.every(stop => stop[3] === 1) ? candidates : [background, ...candidates]
        }
        return [background]
      }
      function luminance(color) {
        return color.slice(0, 3)
          .map(channel => channel / 255)
          .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
          .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
      }
      const samples = nodes.filter((node) => {
        const style = window.getComputedStyle(node)
        const rect = node.getBoundingClientRect()
        const hasDirectText = [...node.childNodes]
          .some(child => child.nodeType === 3 && child.textContent.trim())
        return hasDirectText && rect.width > 0 && rect.height > 0 &&
          style.visibility !== 'hidden' && style.display !== 'none' &&
          !node.closest('button:disabled')
      }).map((node) => {
        const color = parseColor(window.getComputedStyle(node).color)
        const ratios = effectiveBackgrounds(node).map((background) => {
          const foregroundLuminance = luminance(composite(color, background))
          const backgroundLuminance = luminance(background)
          const light = Math.max(foregroundLuminance, backgroundLuminance)
          const dark = Math.min(foregroundLuminance, backgroundLuminance)
          return (light + 0.05) / (dark + 0.05)
        })
        return {
          label: node.textContent.trim().replace(/\s+/g, ' ').slice(0, 80),
          selector: `${node.tagName.toLowerCase()}.${String(node.className).trim().replace(/\s+/g, '.')}`,
          ratio: Math.min(...ratios),
        }
      })
      return { count: samples.length, violations: samples.filter(({ ratio }) => ratio < 4.5) }
    })
    expect(result.count, `${state} should expose visible text samples`).toBeGreaterThan(20)
    expect(result.violations, `${state} contrast violations`).toEqual([])
  }

  await page.goto('./')
  await auditVisibleText('idle')
  await page.getByTestId('start-demo').click()
  await expect(page.getByTestId('health-status')).toContainText('Healthy', { timeout: 20_000 })
  await auditVisibleText('healthy')
  await page.getByTestId('break-audio').click()
  await page.getByTestId('diagnose-stage').click()
  await expect(page.getByTestId('recovery-plan')).toBeVisible()
  await auditVisibleText('staged')
  await page.getByTestId('approve-recovery').click()
  await expect(page.getByTestId('approved-instruction')).toBeVisible()
  await auditVisibleText('approved')
  await page.getByTestId('apply-manually').click()
  await expect(page.getByTestId('applied-instruction')).toBeVisible()
  await auditVisibleText('applied')
  await page.getByTestId('verify-manually').click()
  await expect(page.getByTestId('before-after').locator('.verdict')).toHaveText('recovered')
  await auditVisibleText('recovered')
})

test('honors reduced motion while preserving status visibility', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('./')

  const transitionDuration = await page.getByTestId('health-status').evaluate((node) =>
    window.getComputedStyle(node).transitionDuration,
  )
  expect(['0s', '0.001s', '0.01ms']).toContain(transitionDuration)
  await expect(page.getByTestId('health-status')).toBeVisible()
})
