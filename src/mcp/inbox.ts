export interface InboxMessage {
  sessionId: string;
  sender: string;
  status: string;
  payload: Record<string, unknown>;
  timestamp: number;
  read: boolean;
}

export class MessageInbox {
  private messages: InboxMessage[] = [];
  private storagePath: string;

  constructor(storagePath = "./.inbox") {
    this.storagePath = storagePath;
  }

  post(
    sessionId: string,
    sender: string,
    status: string,
    payload: Record<string, unknown> = {}
  ): InboxMessage {
    const message: InboxMessage = {
      sessionId,
      sender,
      status,
      payload,
      timestamp: Date.now(),
      read: false
    };
    this.messages.push(message);
    this.persist().catch(() => {});
    return message;
  }

  poll(
    sessionId?: string,
    status?: string,
    unreadOnly = true
  ): InboxMessage[] {
    return this.messages
      .filter(m => {
        if (unreadOnly && m.read) return false;
        if (sessionId && m.sessionId !== sessionId) return false;
        if (status && m.status !== status) return false;
        return true;
      })
      .map(m => {
        m.read = true;
        return m;
      });
  }

  getSessionResults(sessionId: string): InboxMessage[] {
    return this.messages.filter(m => m.sessionId === sessionId);
  }

  summary(): string {
    const byStatus: Record<string, number> = {};
    for (const m of this.messages) {
      byStatus[m.status] = (byStatus[m.status] || 0) + 1;
    }
    const parts = [`Inbox: ${this.messages.length} messages`];
    for (const [s, c] of Object.entries(byStatus).sort()) {
      parts.push(`  ${s}: ${c}`);
    }
    return parts.join("\n");
  }

  clear(): void {
    this.messages = [];
  }

  private async persist(): Promise<void> {
    // Skip actual file I/O for now - can be implemented later
  }
}

export function createInbox(storagePath?: string): MessageInbox {
  return new MessageInbox(storagePath);
}