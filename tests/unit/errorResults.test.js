import { describe, expect, it } from 'vitest'
import {
  ERROR_CODES,
  ERROR_DEFINITIONS,
  errorResult,
  resultFromError,
} from '../../src/shared/errors/serviceErrors.js'

const REQUIRED_CODES = [
  'INVALID_TOOL_INPUT',
  'WEBMCP_UNSUPPORTED',
  'WEBMCP_REGISTRATION_FAILED',
  'NO_ACTIVE_SESSION',
  'SESSION_MISMATCH',
  'INVALID_STATE_TRANSITION',
  'STATS_UNAVAILABLE',
  'DIAGNOSIS_STALE',
  'ACTION_NOT_ALLOWED',
  'PLAN_NOT_APPROVED',
  'PLAN_EXPIRED',
  'PLAN_ALREADY_USED',
  'RECOVERY_FAILED',
  'VERIFICATION_INCOMPLETE',
  'DIAGNOSIS_NOT_FOUND',
  'PLAN_NOT_FOUND',
  'MEDIA_CAPABILITY_UNSUPPORTED',
  'LAB_START_FAILED',
  'FAULT_MUTATION_FAILED',
  'OPERATION_CANCELLED',
  'CLEANUP_INCOMPLETE',
]

describe('stable service error mappings', () => {
  it('defines every specification error code exactly once', () => {
    expect(ERROR_CODES).toEqual(REQUIRED_CODES)
    expect(Object.keys(ERROR_DEFINITIONS)).toEqual(REQUIRED_CODES)
  })

  it('returns a stable sanitized shape for known and thrown errors', () => {
    expect(errorResult('PLAN_NOT_APPROVED')).toEqual({
      ok: false,
      error: {
        code: 'PLAN_NOT_APPROVED',
        message: 'The recovery plan requires explicit user approval.',
        recoverable: true,
        suggested_next_step: 'Ask the user to approve or reject the staged plan.',
      },
    })
    expect(
      resultFromError(
        Object.assign(new Error('Failed at 10.0.0.3'), { code: 'MEDIA_CAPABILITY_UNSUPPORTED' }),
        'LAB_START_FAILED',
      ),
    ).toEqual(errorResult('MEDIA_CAPABILITY_UNSUPPORTED'))
  })
})
