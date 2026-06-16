import { Effect, Redacted } from "effect";
import { describe, expect, it } from "@effect/vitest";

import type { ArtifactRecord } from "../shared/artifact/index.js";
import { assessImportPlan } from "./import.plan.js";

const artifact = (records: readonly ArtifactRecord[] = []): readonly ArtifactRecord[] => [
  {
    type: "manifest",
    createdAt: "2026-06-05T00:00:00.000Z",
    source: "https://source.atlassian.net",
  },
  ...records,
];

const defaultConfig = {
  target: "https://target.atlassian.net",
  user: "admin@example.com",
  apiToken: Redacted.make("secret"),
  artifactPath: "artifact.jsonl.gz",
  spaces: [],
  json: false,
};

describe("import assessment", () => {
  it.effect("fails when the artifact manifest is missing", () =>
    Effect.gen(function* () {
      const error = yield* assessImportPlan(defaultConfig, []).pipe(Effect.flip);

      expect(error).toMatchObject({
        code: "artifact.manifestMissing",
        message: "Artifact is missing its manifest.",
      });
    }),
  );

  it.effect("warns when source and target refer to the same site", () =>
    Effect.gen(function* () {
      const plan = yield* assessImportPlan(
        { ...defaultConfig, target: "https://SOURCE.atlassian.net/rest/api/3" },
        artifact(),
      );

      expect(plan.warnings).toEqual([
        {
          code: "SAME_SITE_IMPORT",
          message: "Artifact source matches import target; continuing with same-site import.",
          source: "https://source.atlassian.net",
          target: "https://SOURCE.atlassian.net/rest/api/3",
        },
      ]);
    }),
  );

  it.effect("selects every artifact space by default and keeps per-space record counts", () =>
    Effect.gen(function* () {
      const plan = yield* assessImportPlan(defaultConfig, [
        ...artifact([
          {
            type: "spaceConfiguration",
            spaceKey: "ENG",
            configuration: { enabled: true },
          },
          {
            type: "workItemConversationLinks",
            spaceKey: "OPS",
            workItemKey: "OPS-1",
            conversationIds: ["def"],
          },
          {
            type: "workItemConversationLinks",
            spaceKey: "ENG",
            workItemKey: "ENG-1",
            conversationIds: ["abc"],
          },
        ]),
      ]);

      expect(plan.selectedSpaceKeys).toEqual(["ENG", "OPS"]);
      expect(plan.spaces).toMatchObject([
        {
          spaceKey: "ENG",
          configurationRecords: [{ spaceKey: "ENG" }],
          workItemLinkRecords: [{ workItemKey: "ENG-1" }],
        },
        {
          spaceKey: "OPS",
          configurationRecords: [],
          workItemLinkRecords: [{ workItemKey: "OPS-1" }],
        },
      ]);
    }),
  );

  it.effect(
    "normalizes explicit space selection and records absent artifact spaces as skipped",
    () =>
      Effect.gen(function* () {
        const plan = yield* assessImportPlan(
          { ...defaultConfig, spaces: [" eng ", "OPS", "eng", "ABSENT"] },
          artifact([
            {
              type: "spaceConfiguration",
              spaceKey: "ENG",
              configuration: { enabled: true },
            },
            {
              type: "workItemConversationLinks",
              spaceKey: "OPS",
              workItemKey: "OPS-1",
              conversationIds: ["def"],
            },
          ]),
        );

        expect(plan.selectedSpaceKeys).toEqual(["ABSENT", "ENG", "OPS"]);
        expect(plan.spaces.map((space) => space.spaceKey)).toEqual(["ENG", "OPS"]);
        expect(plan.skippedSpaces).toEqual([
          {
            spaceKey: "ABSENT",
            reason: "absent-from-artifact",
            message: "Selected space ABSENT is not present in the artifact.",
          },
        ]);
      }),
  );
});
