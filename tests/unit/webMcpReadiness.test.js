import { describe, expect, it, vi } from 'vitest'
import { detectWebMcpSupport } from '../../src/features/webmcp/webMcpReadiness.js'

describe('WebMCP readiness', () => {
  it('feature-detects the imperative API', () => {
    expect(
      detectWebMcpSupport({ modelContext: { registerTool: vi.fn() } }),
    ).toBe(true)
    expect(detectWebMcpSupport({})).toBe(false)
  })
})
