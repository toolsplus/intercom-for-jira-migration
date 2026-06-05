import { Effect, Schema } from "effect";
import { describe, expect, it } from "@effect/vitest";

import {
  ConversationLinkMigrationValue,
  ConversationLinkPropertyValue,
  LegacyConversationLinkPropertyValue,
} from "../shared/app/index.js";

describe("export Jira domain helpers", () => {
  it.effect("decodes current and legacy conversation-link property values with schemas", () =>
    Effect.gen(function* () {
      const current = yield* Schema.decodeUnknownEffect(ConversationLinkMigrationValue)({
        count: 3,
        conversationIds: ["abc", " def ", "abc"],
      });
      expect([...current.conversationIds]).toEqual(["abc", "def"]);

      const legacy = yield* Schema.decodeUnknownEffect(LegacyConversationLinkPropertyValue)([
        { id: "abc" },
        { id: "def" },
        { id: "abc" },
      ]);
      expect([...legacy.conversationIds]).toEqual(["abc", "def"]);

      const currentForImport = ConversationLinkPropertyValue.make({
        count: 1,
        conversationIds: new Set(["abc"]),
      });
      expect(currentForImport.count).toBe(1);
      expect([...currentForImport.conversationIds]).toEqual(["abc"]);
    }),
  );

  it.effect("rejects blank conversation IDs", () =>
    Effect.gen(function* () {
      yield* Schema.decodeUnknownEffect(ConversationLinkMigrationValue)({
        count: 1,
        conversationIds: ["   "],
      }).pipe(Effect.flip);

      yield* Schema.decodeUnknownEffect(ConversationLinkPropertyValue)({
        count: 1,
        conversationIds: new Set(["\t"]),
      }).pipe(Effect.flip);
    }),
  );
});
