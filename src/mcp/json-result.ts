/** Compact JSON for MCP tool responses (saves agent tokens). Set AIO_JSON_PRETTY=1 for debug. */
export function formatJson(data: unknown): string {
  const pretty = process.env.AIO_JSON_PRETTY === '1'
  return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)
}

/** Detect an error payload (ok:false) to automatically set isError. */
function isErrorPayload(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'ok' in data &&
    (data as Record<string, unknown>).ok === false
  )
}

export function jsonResult(data: unknown) {
  const content = [{ type: 'text' as const, text: formatJson(data) }]
  const isError = isErrorPayload(data)
  return isError ? { content, isError: true as const } : { content }
}
