export type TaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

export interface TaskNode {
  id: string
  label: string
  fn?: () => Promise<unknown>
  deps: string[]
  layer: number
  timeout: number
  status: TaskStatus
  result?: unknown
  error?: string
}
