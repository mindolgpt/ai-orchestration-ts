/** Compact JSON for MCP tool responses (saves agent tokens). Set AIO_JSON_PRETTY=1 for debug. */
export function formatJson(data: unknown): string {
  const pretty = process.env.AIO_JSON_PRETTY === '1'
  return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)
}

export function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: formatJson(data) }] }
}
