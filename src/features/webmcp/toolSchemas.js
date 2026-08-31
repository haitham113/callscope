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
    inputSchema: Object.freeze({ type: 'object', properties: Object.freeze({}) }),
    annotations: Object.freeze({ readOnlyHint: true }),
  }),
  Object.freeze({
    name: 'inspect_call_state',
    description: 'Inspect sanitized live peer, ICE, media, sender, receiver, fault, and health state.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        session_id: Object.freeze({ type: 'string' }),
        detail: Object.freeze({
          type: 'string',
          enum: Object.freeze(['summary', 'media', 'connection', 'all']),
        }),
      }),
      required: Object.freeze(['session_id']),
    }),
    annotations: Object.freeze({ readOnlyHint: true }),
  }),
  Object.freeze({
    name: 'run_call_diagnostics',
    description: 'Sample the active call and return ranked, evidence-backed diagnostic findings.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        session_id: Object.freeze({ type: 'string' }),
        symptom: Object.freeze({
          type: 'string',
          enum: Object.freeze(['silent_audio', 'poor_video', 'connection_problem', 'unknown']),
        }),
        sample_duration_ms: Object.freeze({
          type: 'integer',
          minimum: 1000,
          maximum: 5000,
          default: 2000,
        }),
      }),
      required: Object.freeze(['session_id', 'symptom']),
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
    }),
    annotations: Object.freeze({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
    }),
  }),
  Object.freeze({
    name: 'apply_recovery_action',
    description: 'Apply one allowlisted repair only after current application-owned human approval.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        session_id: Object.freeze({ type: 'string' }),
        plan_id: Object.freeze({ type: 'string' }),
      }),
      required: Object.freeze(['session_id', 'plan_id']),
    }),
    annotations: Object.freeze({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    }),
  }),
  Object.freeze({
    name: 'compare_to_failure_baseline',
    description: 'Capture fresh stabilized evidence and compare it with the bound failure baseline.',
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
    }),
    annotations: Object.freeze({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    }),
  }),
])
