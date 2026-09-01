import { errorResult } from '../../shared/errors/serviceErrors.js'
import { createWebMcpToolHandlers } from './toolHandlers.js'
import { TOOL_DEFINITIONS, TOOL_NAMES } from './toolSchemas.js'
import { detectWebMcpSupport } from './webMcpReadiness.js'

let activeRegistration = null

function unavailableRegistration(code) {
  return Object.freeze({
    supported: false,
    toolNames: Object.freeze([]),
    signal: null,
    error: errorResult(code),
    dispose() {},
  })
}

function awaitRegistration(value, signal) {
  if (signal.aborted) {
    return Promise.reject(new DOMException('WebMCP registration cancelled.', 'AbortError'))
  }
  return new Promise((resolve, reject) => {
    function onAbort() {
      reject(new DOMException('WebMCP registration cancelled.', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(value).then(
      (result) => {
        signal.removeEventListener('abort', onAbort)
        resolve(result)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export async function registerCallScopeTools({
  documentRef = globalThis.document,
  agent,
  lifecycleSignal,
}) {
  const modelContext = documentRef?.modelContext
  if (!detectWebMcpSupport(documentRef)) return unavailableRegistration('WEBMCP_UNSUPPORTED')
  if (lifecycleSignal?.aborted) return unavailableRegistration('OPERATION_CANCELLED')

  if (activeRegistration) activeRegistration.dispose()
  const abortController = new AbortController()
  const handlers = createWebMcpToolHandlers(agent)
  let disposed = false
  let removeLifecycleListener = () => {}

  const registration = {
    supported: true,
    toolNames: TOOL_NAMES,
    signal: abortController.signal,
    error: null,
    dispose() {
      if (disposed) return
      disposed = true
      removeLifecycleListener()
      abortController.abort('CallScope WebMCP lifecycle ended.')
      if (activeRegistration === registration) activeRegistration = null
    },
  }
  if (lifecycleSignal) {
    const onLifecycleAbort = () => registration.dispose()
    lifecycleSignal.addEventListener('abort', onLifecycleAbort, { once: true })
    removeLifecycleListener = () => lifecycleSignal.removeEventListener('abort', onLifecycleAbort)
  }
  activeRegistration = registration

  try {
    for (const definition of TOOL_DEFINITIONS) {
      await awaitRegistration(modelContext.registerTool(
        {
          name: definition.name,
          description: definition.description,
          inputSchema: definition.inputSchema,
          annotations: definition.annotations,
          execute: handlers[definition.name],
        },
        { signal: abortController.signal },
      ), abortController.signal)
    }
    if (disposed) return unavailableRegistration('OPERATION_CANCELLED')
    return Object.freeze(registration)
  } catch (error) {
    const cancelled = disposed || abortController.signal.aborted || error?.name === 'AbortError'
    registration.dispose()
    return unavailableRegistration(
      cancelled ? 'OPERATION_CANCELLED' : 'WEBMCP_REGISTRATION_FAILED',
    )
  }
}
