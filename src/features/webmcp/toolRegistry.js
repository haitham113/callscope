import { errorResult } from '../../shared/errors/serviceErrors.js'
import { createWebMcpToolHandlers } from './toolHandlers.js'
import { TOOL_DEFINITIONS, TOOL_NAMES } from './toolSchemas.js'
import { detectWebMcpSupport } from './webMcpReadiness.js'

let activeRegistration = null

function unsupportedRegistration() {
  return Object.freeze({
    supported: false,
    toolNames: Object.freeze([]),
    signal: null,
    error: errorResult('WEBMCP_UNSUPPORTED'),
    dispose() {},
  })
}

export function registerCallScopeTools({ documentRef = globalThis.document, agent }) {
  const modelContext = documentRef?.modelContext
  if (!detectWebMcpSupport(documentRef)) return unsupportedRegistration()

  if (activeRegistration) activeRegistration.dispose()
  const abortController = new AbortController()
  const handlers = createWebMcpToolHandlers(agent)
  let disposed = false

  const registration = {
    supported: true,
    toolNames: TOOL_NAMES,
    signal: abortController.signal,
    error: null,
    dispose() {
      if (disposed) return
      disposed = true
      abortController.abort('CallScope WebMCP lifecycle ended.')
      if (activeRegistration === registration) activeRegistration = null
    },
  }

  try {
    for (const definition of TOOL_DEFINITIONS) {
      modelContext.registerTool(
        {
          name: definition.name,
          description: definition.description,
          inputSchema: definition.inputSchema,
          annotations: definition.annotations,
          execute: handlers[definition.name],
        },
        { signal: abortController.signal },
      )
    }
    activeRegistration = registration
    return Object.freeze(registration)
  } catch {
    registration.dispose()
    return unsupportedRegistration()
  }
}
