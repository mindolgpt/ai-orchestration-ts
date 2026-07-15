/// <reference types="vitest/globals" />
import { MessageInbox } from "../src/mcp/inbox";

describe("MessageInbox", () => {
  test("post and poll", () => {
    const inbox = new MessageInbox();
    inbox.post("sess_1", "worker-a", "completed", { result: "ok" });
    const msgs = inbox.poll();
    expect(msgs.length).toBe(1);
    expect(msgs[0].status).toBe("completed");
  });

  test("unread only", () => {
    const inbox = new MessageInbox();
    inbox.post("sess_1", "a", "completed");
    inbox.post("sess_2", "b", "failed");
    const first = inbox.poll();
    expect(first.length).toBe(2);
    const second = inbox.poll();
    expect(second.length).toBe(0);
  });

  test("filter by session", () => {
    const inbox = new MessageInbox();
    inbox.post("sess_1", "a", "completed");
    inbox.post("sess_2", "b", "completed");
    const msgs = inbox.poll("sess_1");
    expect(msgs.length).toBe(1);
    expect(msgs[0].sessionId).toBe("sess_1");
  });
});