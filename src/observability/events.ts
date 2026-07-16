import * as fs from "fs/promises";
import * as path from "path";
import { resolveProjectRoot } from "@/knowledge/paths";

export type EventLevel = "info" | "warn" | "error" | "debug";

export interface OrchestratorEvent {
  ts: number;
  type: string;
  level: EventLevel;
  message?: string;
  data?: Record<string, unknown>;
}

/**
 * Append-only JSONL event log under <project>/.aio/events.jsonl
 * Disable with AIO_EVENTS=0
 */
export class EventLog {
  private enabled: boolean;
  private filePath: string;
  private buffer: OrchestratorEvent[] = [];
  private maxBuffer: number;

  constructor(projectRoot?: string, maxBuffer = 500) {
    this.enabled = process.env.AIO_EVENTS !== "0";
    const root = projectRoot || resolveProjectRoot();
    this.filePath = path.join(root, ".aio", "events.jsonl");
    this.maxBuffer = maxBuffer;
  }

  async emit(
    type: string,
    data?: Record<string, unknown>,
    level: EventLevel = "info",
    message?: string
  ): Promise<void> {
    const event: OrchestratorEvent = {
      ts: Date.now(),
      type,
      level,
      message,
      data,
    };
    this.buffer.push(event);
    if (this.buffer.length > this.maxBuffer) {
      this.buffer = this.buffer.slice(-this.maxBuffer);
    }
    if (!this.enabled) return;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.appendFile(this.filePath, JSON.stringify(event) + "\n", "utf-8");
    } catch {
      /* ignore disk errors */
    }
  }

  recent(limit = 50, typePrefix?: string): OrchestratorEvent[] {
    const filtered = typePrefix
      ? this.buffer.filter((e) => e.type.startsWith(typePrefix))
      : this.buffer;
    return filtered.slice(-limit);
  }

  get path(): string {
    return this.filePath;
  }
}

let shared: EventLog | null = null;

export function getEventLog(projectRoot?: string): EventLog {
  if (!shared) shared = new EventLog(projectRoot);
  return shared;
}

export function resetEventLogForTests(): void {
  shared = null;
}
