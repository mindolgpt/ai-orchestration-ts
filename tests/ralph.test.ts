/// <reference types="vitest/globals" />
import { RalphLoop } from "../src/ralph/loop";

describe("RalphLoop", () => {
  test("success on first try", async () => {
    const loop = new RalphLoop({ maxRetries: 3, verifyEvery: 1 });
    const result = await loop.run(
      "test",
      async () => "output",
      async () => true
    );
    expect(result.status).toBe("success");
    expect(result.output).toBe("output");
    expect(result.attempts).toBeGreaterThanOrEqual(1);
  });

  test("retry then success", async () => {
    let callCount = 0;
    const loop = new RalphLoop({ maxRetries: 3, verifyEvery: 1 });

    const flakyImpl = async () => {
      callCount++;
      if (callCount < 3) throw new Error("not ready");
      return "done";
    };

    const result = await loop.run("flaky", flakyImpl, async () => true);
    expect(result.status).toBe("success");
    expect(callCount).toBe(3);
  });

  test("exhaust retries", async () => {
    const loop = new RalphLoop({ maxRetries: 2 });
    const result = await loop.run(
      "fail",
      async () => { throw new Error("always fail"); },
      async () => true
    );
    expect(result.status).toBe("failed");
  });
});