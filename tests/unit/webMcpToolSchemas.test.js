import { describe, expect, it } from 'vitest'
import {
  TOOL_DEFINITIONS,
  TOOL_NAMES,
} from '../../src/features/webmcp/toolSchemas.js'

describe('WebMCP tool contracts', () => {
  it('defines exactly the seven specification tools in order', () => {
    expect(TOOL_NAMES).toEqual([
      'get_lab_context',
      'inspect_call_state',
      'run_call_diagnostics',
      'stage_recovery_plan',
      'apply_recovery_action',
      'compare_to_failure_baseline',
      'generate_incident_report',
    ])
    expect(TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual(TOOL_NAMES)
  })

  it('preserves the exact input schemas and annotations from the product specification', () => {
    expect(TOOL_DEFINITIONS.map(({ name, inputSchema, annotations }) => ({
      name,
      inputSchema,
      annotations,
    }))).toMatchSnapshot()
  })

  it('advertises the same closed input contract enforced by handler validation', () => {
    expect(TOOL_DEFINITIONS.every(({ inputSchema }) =>
      inputSchema.additionalProperties === false,
    )).toBe(true)
  })

  it('advertises only symptoms with deterministic end-to-end diagnostic paths', () => {
    const diagnosticTool = TOOL_DEFINITIONS.find(({ name }) => name === 'run_call_diagnostics')

    expect(diagnosticTool.inputSchema.properties.symptom).toEqual({
      type: 'string',
      enum: ['silent_audio', 'poor_video'],
      description: 'silent_audio diagnoses the disabled outbound audio track; poor_video diagnoses the constrained outbound video bitrate.',
    })
  })

  it('makes the active browser session the normal diagnostics context', () => {
    const diagnosticTool = TOOL_DEFINITIONS.find(({ name }) => name === 'run_call_diagnostics')

    expect(diagnosticTool.description).toMatch(/currently active CallScope WebRTC session/i)
    expect(diagnosticTool.inputSchema.required).toEqual(['symptom'])
    expect(diagnosticTool.inputSchema.properties.session_id).toMatchObject({
      type: 'string',
      description: expect.stringMatching(/optional/i),
    })
    expect(diagnosticTool.description).not.toMatch(/ask|provide.*session/i)
  })
})
