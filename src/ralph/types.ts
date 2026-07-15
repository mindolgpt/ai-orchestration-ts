export interface RalphResult {
  taskId: string;
  status: "running" | "success" | "failed";
  attempts: number;
  output: unknown;
  error: string | null;
  duration: number;
  startedAt: number;
}