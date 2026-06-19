import { Effect, Layer, Redacted, Stream } from "effect";
import { TestConsole } from "effect/testing";
import { describe, expect, it } from "@effect/vitest";

import type { ArtifactRecord } from "../shared/artifact/index.js";
import { ArtifactReaderService } from "../shared/artifact/index.js";
import type { ImportConfig } from "../shared/config/index.js";
import { AppError } from "../errors.js";
import { ImportJiraService } from "./jira.service.js";
import { ImportService } from "./import.service.js";

const config: ImportConfig = {
  target: "https://target.atlassian.net",
  user: "admin@example.com",
  apiToken: Redacted.make("secret"),
  artifactPath: "artifact.jsonl.gz",
  spaces: [],
  json: false,
};

const records: readonly ArtifactRecord[] = [
  {
    type: "manifest",
    createdAt: "2026-06-05T00:00:00.000Z",
    source: "https://source.atlassian.net",
  },
  {
    type: "spaceConfiguration",
    spaceKey: "ENG",
    configuration: { enabled: true },
  },
  {
    type: "workItemConversationLinks",
    spaceKey: "ENG",
    workItemKey: "ENG-1",
    conversationIds: ["abc"],
  },
];

const readerLayerFromRecords = (artifactRecords: readonly ArtifactRecord[]) =>
  Layer.succeed(
    ArtifactReaderService,
    ArtifactReaderService.of({
      read: () => Stream.fromIterable(artifactRecords),
    }),
  );

const readerLayer = readerLayerFromRecords(records);

const runImport = (
  artifactRecords: readonly ArtifactRecord[],
  jiraService: ImportJiraService["Service"],
  importConfig = config,
) =>
  ImportService.use((service) => service.run).pipe(
    Effect.provide(
      ImportService.layerNoDeps(importConfig).pipe(
        Layer.provide(
          Layer.mergeAll(
            readerLayerFromRecords(artifactRecords),
            Layer.succeed(ImportJiraService, ImportJiraService.of(jiraService)),
            TestConsole.layer,
          ),
        ),
      ),
    ),
  );

const defaultImportJiraService: ImportJiraService["Service"] = {
  verifyGlobalAdmin: Effect.void,
  targetSpaceAvailable: () => Effect.succeed(true),
  writeSpaceConfiguration: () => Effect.void,
  resolveWorkItems: (workItemKeys) =>
    Effect.succeed(
      workItemKeys.map((key, index) => ({ requestedKey: key, id: String(index), key })),
    ),
  writeWorkItemConversationLinks: () => Effect.void,
};

const linkRecords = (count: number): readonly ArtifactRecord[] => [
  {
    type: "manifest",
    createdAt: "2026-06-05T00:00:00.000Z",
    source: "https://source.atlassian.net",
  },
  ...Array.from({ length: count }, (_, index) => ({
    type: "workItemConversationLinks" as const,
    spaceKey: "ENG",
    workItemKey: `ENG-${String(index + 1)}`,
    conversationIds: [`conversation-${String(index + 1)}`],
  })),
];

describe("import orchestration", () => {
  it.effect("verifies admin permission and writes space configuration before work item links", () =>
    Effect.gen(function* () {
      const operations: string[] = [];
      const jiraLayer = Layer.succeed(
        ImportJiraService,
        ImportJiraService.of({
          ...defaultImportJiraService,
          verifyGlobalAdmin: Effect.sync(() => {
            operations.push("admin");
          }),
          targetSpaceAvailable: (spaceKey) =>
            Effect.sync(() => {
              operations.push(`space:${spaceKey}`);
              return true;
            }),
          writeSpaceConfiguration: (spaceKey) =>
            Effect.sync(() => {
              operations.push(`configuration:${spaceKey}`);
            }),
          resolveWorkItems: (workItemKeys) =>
            Effect.sync(() => {
              operations.push(`resolve:${workItemKeys.join(",")}`);
              return [{ requestedKey: "ENG-1", id: "10001", key: "ENG-1" }];
            }),
          writeWorkItemConversationLinks: (spaceKey, propertyUpdates) =>
            Effect.sync(() => {
              operations.push(`links:${spaceKey}:${String(propertyUpdates.length)}`);
              expect(propertyUpdates).toEqual([
                {
                  issueId: "10001",
                  value: { count: 1, conversationIds: ["abc"] },
                },
              ]);
            }),
        }),
      );

      const summary = yield* ImportService.use((service) => service.run).pipe(
        Effect.provide(
          ImportService.layerNoDeps(config).pipe(
            Layer.provide(Layer.mergeAll(readerLayer, jiraLayer, TestConsole.layer)),
          ),
        ),
      );

      expect(operations).toEqual([
        "admin",
        "space:ENG",
        "configuration:ENG",
        "resolve:ENG-1",
        "links:ENG:1",
      ]);
      expect(summary).toMatchObject({
        spacesImported: 1,
        spaceConfigurationsWritten: 1,
        workItemLinkRecordsImported: 1,
        conversationIdsImported: 1,
      });
    }),
  );

  it.effect("deduplicates imported conversation IDs in property updates and summary counts", () =>
    Effect.gen(function* () {
      let submittedPropertyUpdates = 0;
      const summary = yield* runImport(
        [
          {
            type: "manifest",
            createdAt: "2026-06-05T00:00:00.000Z",
            source: "https://source.atlassian.net",
          },
          {
            type: "workItemConversationLinks",
            spaceKey: "ENG",
            workItemKey: "ENG-1",
            conversationIds: ["abc", "abc", "def"],
          },
        ],
        {
          ...defaultImportJiraService,
          resolveWorkItems: () =>
            Effect.succeed([{ requestedKey: "ENG-1", id: "10001", key: "ENG-1" }]),
          writeWorkItemConversationLinks: (_spaceKey, propertyUpdates) =>
            Effect.sync(() => {
              submittedPropertyUpdates += 1;
              expect(propertyUpdates).toEqual([
                {
                  issueId: "10001",
                  value: { count: 2, conversationIds: ["abc", "def"] },
                },
              ]);
            }),
        },
      );

      expect(submittedPropertyUpdates).toBe(1);
      expect(summary.workItemLinkRecordsImported).toBe(1);
      expect(summary.conversationIdsImported).toBe(2);
    }),
  );

  it.effect("limits skipped space details in import summaries", () =>
    Effect.gen(function* () {
      const selectedSpaces = Array.from(
        { length: 101 },
        (_, index) => `ABSENT-${String(index + 1)}`,
      );
      const summary = yield* runImport(
        [
          {
            type: "manifest",
            createdAt: "2026-06-05T00:00:00.000Z",
            source: "https://source.atlassian.net",
          },
        ],
        defaultImportJiraService,
        { ...config, spaces: selectedSpaces },
      );

      expect(summary.skippedSpaceCount).toBe(101);
      expect(summary.skippedSpaces).toHaveLength(100);
      expect(summary.detailsTruncated).toBe(true);
    }),
  );

  it.effect("batches work item links and records missing or mismatched target work items", () =>
    Effect.gen(function* () {
      const batchSizes: number[] = [];
      const summary = yield* runImport(linkRecords(101), {
        ...defaultImportJiraService,
        resolveWorkItems: (workItemKeys) =>
          Effect.succeed(
            workItemKeys.flatMap((key, index) => {
              if (key === "ENG-2") {
                return [];
              }
              if (key === "ENG-3") {
                return [{ requestedKey: key, id: "mismatch", key: "ENG-300" }];
              }
              return [{ requestedKey: key, id: String(index), key }];
            }),
          ),
        writeWorkItemConversationLinks: (_spaceKey, propertyUpdates) =>
          Effect.sync(() => {
            batchSizes.push(propertyUpdates.length);
          }),
      });

      expect(batchSizes).toEqual([98, 1]);
      expect(summary.workItemLinkRecordsImported).toBe(99);
      expect(summary.skippedWorkItemLinks).toMatchObject([
        {
          workItemKey: "ENG-2",
          reason: "missing-target-work-item",
          message: "Target work item ENG-2 is missing, inaccessible, or may have been moved.",
        },
        { workItemKey: "ENG-3", reason: "target-key-mismatch" },
      ]);
    }),
  );

  it.effect("propagates target space lookup errors instead of recording skipped spaces", () =>
    Effect.gen(function* () {
      const error = yield* runImport(records, {
        ...defaultImportJiraService,
        targetSpaceAvailable: () =>
          new AppError("jira.transient", "Jira target space lookup failed.", {
            context: { path: "/rest/api/3/project/search" },
          }),
      }).pipe(Effect.flip);

      expect(error).toMatchObject({
        code: "jira.transient",
        message: "Jira target space lookup failed.",
      });
    }),
  );
});
