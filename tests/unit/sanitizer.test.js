import { describe, expect, it } from 'vitest'
import {
  containsSensitiveData,
  sanitizeValue,
} from '../../src/features/diagnostics/services/sanitizer.js'

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

  it('sanitizes deeply nested success and error payloads including camelCase keys', () => {
    const result = sanitizeValue({
      ok: false,
      error: {
        code: 'RECOVERY_FAILED',
        message: 'Peer 10.0.0.7 returned SDP v=0\r\no=- 1 1 IN IP4 127.0.0.1',
        details: [{ deviceLabel: 'Office microphone', remoteAddress: '2001:db8::8' }],
      },
      nested: [{ localIp: '192.168.0.4', safe: 'host / udp / direct' }],
    })

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'RECOVERY_FAILED',
        message: '[redacted protocol description]',
        details: [{}],
      },
      nested: [{ safe: 'host / udp / direct' }],
    })
    expect(containsSensitiveData(result)).toBe(false)
  })

  it('redacts compressed IPv6 in nested display text and detects sensitive nested keys', () => {
    expect(sanitizeValue({ nested: { message: 'Peer 2001:db8::8 failed' } })).toEqual({
      nested: { message: 'Peer [redacted IP] failed' },
    })
    expect(containsSensitiveData({ safe: { deviceLabel: 'Private microphone' } })).toBe(true)
  })

  it('removes compound token, device-label, and full-candidate fields', () => {
    const result = sanitizeValue({
      accessToken: 'secret-token',
      apiToken: 'secret-token',
      trackLabel: 'Actual microphone',
      iceCandidate: 'candidate:1 1 udp 1 host.local 5000 typ host',
      candidateType: 'host',
      message: 'ICE candidate:1 1 udp 1 host.local 5000 typ host',
    })
    expect(result).toEqual({
      candidateType: 'host',
      message: '[redacted candidate]',
    })
  })
})
