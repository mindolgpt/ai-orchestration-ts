import { Issue } from "@/knowledge/types";
import { MessageInbox } from "@/mcp/inbox";

export class BranchHunt {
  private issues: Issue[] = [];
  private scanCount = 0;

  constructor(private inbox: MessageInbox) {}

  async scanForIssues(scanFn: () => Promise<Array<{ description: string; file: string; severity: string }>>): Promise<Issue[]> {
    console.log("[Branch Hunt] 탐색 시작 — DFS 스캔");
    const rawIssues = await scanFn();

    for (let i = 0; i < rawIssues.length; i++) {
      const { description, file, severity } = rawIssues[i];
      const validSeverity = ["low", "medium", "high", "critical"].includes(severity) ? severity as Issue["severity"] : "medium";
      const issue: Issue = {
        id: `issue_${this.scanCount}_${i}`,
        description,
        file,
        severity: validSeverity,
        resolved: false
      };
      this.issues.push(issue);

      console.log(`  발견 → 분기: ${description.slice(0, 60)}... (${file})`);
    }

    this.scanCount++;
    return this.issues;
  }

  async collectResults(): Promise<Array<{ issue_id: string; resolved: boolean; resolution: string }>> {
    const results: Array<{ issue_id: string; resolved: boolean; resolution: string }> = [];
    const msgs = this.inbox.poll(undefined, "completed");

    for (let i = 0; i < Math.min(this.issues.length, msgs.length); i++) {
      const issue = this.issues[i];
      const msg = msgs[i];
      issue.resolved = true;
      const stdout = msg.payload?.stdout;
      const summary = msg.payload?.summary;
      issue.resolution = (typeof stdout === 'string' ? stdout : typeof summary === 'string' ? summary : "").slice(0, 200);
      results.push({
        issue_id: issue.id,
        resolved: true,
        resolution: issue.resolution
      });
    }

    return results;
  }

  summary(): string {
    const total = this.issues.length;
    const resolved = this.issues.filter(i => i.resolved).length;
    return `Branch Hunt: ${total}개 이슈, ${resolved}개 해결`;
  }
}

export function createBranchHunt(inbox: MessageInbox): BranchHunt {
  return new BranchHunt(inbox);
}
