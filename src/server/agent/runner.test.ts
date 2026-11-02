import { describe, expect, it } from "vitest";
import { isTransientNetworkError, withNetworkRetry } from "./runner";

describe("LLM calls survive a dropped connection", () => {
  it("retries a connection that drops mid-response, but not other errors", async () => {
    let calls = 0;
    const flaky = () => (++calls < 3 ? Promise.reject(new TypeError("terminated")) : Promise.resolve("ok"));
    expect(await withNetworkRetry(flaky, 3, 1)).toBe("ok");
    expect(calls).toBe(3);

    let bad = 0;
    await expect(withNetworkRetry(() => (bad++, Promise.reject(new Error("Model output was cut off (max tokens)."))), 3, 1)).rejects.toThrow(/cut off/);
    expect(bad).toBe(1);
    expect(isTransientNetworkError(Object.assign(new Error("x"), { cause: { code: "ECONNRESET" } }))).toBe(true);
  });
});
