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
})
