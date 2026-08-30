export function detectWebMcpSupport(documentObject = document) {
  return Boolean(
    documentObject?.modelContext &&
      typeof documentObject.modelContext.registerTool === 'function',
  )
}
