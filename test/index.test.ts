import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { greet } from "../src/index.js";

describe("greet", () => {
  it("returns a greeting effect", async () => {
    await expect(Effect.runPromise(greet("Effect"))).resolves.toBe("Hello, Effect!");
  });
});
