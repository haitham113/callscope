import { SUPPORTED_DIAGNOSTIC_SYMPTOMS } from '../diagnostics/services/diagnosticRules.js'

export const TOOL_NAMES = Object.freeze([
  'get_lab_context',
  'inspect_call_state',
  'run_call_diagnostics',
  'stage_recovery_plan',
  'apply_recovery_action',
  'compare_to_failure_baseline',
  'generate_incident_report',
])

export const TOOL_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: 'get_lab_context',
    description: 'Read a compact overview of the active CallScope lab and the safest next tools.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({}),
      additionalProperties: false,
    }),
    annotations: Object.freeze({ readOnlyHint: true }),
  }),
  Object.freeze({
    name: 'inspect_call_state',
    description: 'Inspect sanitized live peer, ICE, media, sender, receiver, fault, and health state for the currently active CallScope WebRTC session.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        session_id: Object.freeze({
          type: 'string',
          description: 'Optional expected session identifier from a prior structured tool result. Omit it to inspect the currently active browser session.',
        }),
        detail: Object.freeze({
          type: 'string',
          enum: Object.freeze(['summary', 'media', 'connection', 'all']),
        }),
      }),
      additionalProperties: false,
    }),
    annotations: Object.freeze({ readOnlyHint: true }),
  }),
  Object.freeze({
    name: 'run_call_diagnostics',
    description: 'Diagnose the currently active CallScope WebRTC session using fresh browser evidence and return ranked findings, limitations, and compatible recovery actions.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        session_id: Object.freeze({
          type: 'string',
          description: 'Optional expected session identifier from a prior structured tool result. Omit it to diagnose the currently active browser session.',
        }),
        symptom: Object.freeze({
          type: 'string',
          enum: SUPPORTED_DIAGNOSTIC_SYMPTOMS,
          description: 'silent_audio diagnoses the disabled outbound audio track; poor_video diagnoses the constrained outbound video bitrate.',
        }),
        sample_duration_ms: Object.freeze({
          type: 'integer',
          minimum: 1000,
          maximum: 5000,
          default: 2000,
        }),
      }),
      required: Object.freeze(['symptom']),
      additionalProperties: false,
    }),
    annotations: Object.freeze({ readOnlyHint: true }),
  }),
  Object.freeze({
    name: 'stage_recovery_plan',
    description: 'Display one compatible recovery plan for explicit human review in CallScope.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        session_id: Object.freeze({ type: 'string' }),
        diagnosis_id: Object.freeze({ type: 'string' }),
        action: Object.freeze({
          type: 'string',
          enum: Object.freeze([
            'enable_audio_track',
            'restore_video_bitrate',
            'reattach_generated_track',
          ]),
        }),
        reason: Object.freeze({ type: 'string', maxLength: 500 }),
        expected_result: Object.freeze({ type: 'string', maxLength: 300 }),
      }),
      required: Object.freeze([
        'session_id',
        'diagnosis_id',
        'action',
        'reason',
        'expected_result',
      ]),
      additionalProperties: false,
    }),
    annotations: Object.freeze({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    }),
  }),
  Object.freeze({
    name: 'apply_recovery_action',
    description: 'Apply one approved allowlisted repair and leave recovery verification pending.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        session_id: Object.freeze({ type: 'string' }),
        plan_id: Object.freeze({ type: 'string' }),
      }),
      required: Object.freeze(['session_id', 'plan_id']),
      additionalProperties: false,
    }),
    annotations: Object.freeze({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    }),
  }),
  Object.freeze({
    name: 'compare_to_failure_baseline',
    description: 'Authoritatively verify recovery from fresh stabilized evidence and the bound failure baseline.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        session_id: Object.freeze({ type: 'string' }),
        plan_id: Object.freeze({ type: 'string' }),
        sample_duration_ms: Object.freeze({
          type: 'integer',
          minimum: 1000,
          maximum: 5000,
          default: 2000,
        }),
      }),
      required: Object.freeze(['session_id', 'plan_id']),
      additionalProperties: false,
    }),
    annotations: Object.freeze({ readOnlyHint: true }),
  }),
  Object.freeze({
    name: 'generate_incident_report',
    description: 'Build and display a sanitized report from the verified active incident.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        session_id: Object.freeze({ type: 'string' }),
        format: Object.freeze({
          type: 'string',
          enum: Object.freeze(['summary', 'markdown']),
          default: 'summary',
        }),
      }),
      required: Object.freeze(['session_id']),
      additionalProperties: false,
    }),
    annotations: Object.freeze({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    }),
  }),
])
