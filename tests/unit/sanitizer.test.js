import { describe, expect, it } from 'vitest'
import { sanitizeValue } from '../../src/features/diagnostics/services/sanitizer.js'

describe('recursive sanitization', () => {
  it('removes sensitive keys and redacts nested address-like strings', () => {
    const result = sanitizeValue({
      safe: 'host / udp / direct',
      candidate: 'candidate:1 1 udp 1 192.168.1.2 5000 typ host',
      nested: {
        sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1',
        message: 'Contact 203.0.113.7 for details',
        device_label: 'Actual microphone',
      },
    })
    expect(result).toEqual({
      safe: 'host / udp / direct',
      nested: { message: 'Contact [redacted IP] for details' },
    })
  })
})
