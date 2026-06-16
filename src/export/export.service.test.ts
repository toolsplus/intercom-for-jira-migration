import { NodeServices } from "@effect/platform-node";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Redacted, Stream } from "effect";
import { TestConsole } from "effect/testing";
import { describe, expect, it } from "@effect/vitest";

import { InspectService } from "../inspect/index.js";
import {
  conversationLinksPropertyKey,
  spaceConfigurationPropertyKey,
} from "../shared/app/index.js";
import { JiraClient } from "../shared/jira/index.js";
import { type ArtifactRecord, ArtifactWriterService } from "../shared/artifact/index.js";
import { ExportService } from "./index.js";
import type { ExportConfig } from "../shared/config/index.js";

const tempPath = async (name: string) => join(await mkdtemp(join(tmpdir(), "ifj-")), name);
const inspectLayer = InspectService.layer.pipe(Layer.provide(NodeServices.layer));
const inspectWrittenArtifact = (path: string) =>
  InspectService.use((service) => service.run(path)).pipe(Effect.provide(inspectLayer));
const artifactWriterLayer = ArtifactWriterService.layer.pipe(Layer.provide(NodeServices.layer));
const exportServiceTestDeps = (jiraClient: JiraClient["Service"]) =>
  Layer.mergeAll(artifactWriterLayer, Layer.succeed(JiraClient, JiraClient.of(jiraClient)));
const runExport = (config: ExportConfig, jiraClient: JiraClient["Service"]) =>
  ExportService.use((service) => service.run).pipe(
    Effect.provide(
      ExportService.layerNoDeps(config).pipe(Layer.provide(exportServiceTestDeps(jiraClient))),
    ),
  );
const defaultJiraClient: JiraClient["Service"] = {
  getMyPermissions: () => Effect.succeed({ ADMINISTER: { havePermission: true } }),
  searchProjectSpaces: () =>
    Stream.fromIterable([
      { key: "ENG", properties: { [spaceConfigurationPropertyKey]: { enabled: true } } },
    ]),
  approximateSearchCount: () => Effect.succeed(1),
  searchWorkItems: () =>
    Stream.fromIterable([
      {
        key: "ENG-1",
        properties: {
          [conversationLinksPropertyKey]: { count: 1, conversationIds: ["abc"] },
        },
      },
    ]),
  writeProjectProperty: () => Effect.void,
  bulkFetchWorkItems: () => Effect.succeed([]),
  submitIssuePropertyBulkTask: () =>
    Effect.succeed("https://example.atlassian.net/rest/api/3/task/task-1"),
  getTask: () => Effect.succeed({ status: "COMPLETE" }),
};

describe("export orchestration", () => {
  it.effect("exports through an injected artifact writer service", () =>
    Effect.gen(function* () {
      const writtenRecords: ArtifactRecord[] = [];
      const jiraClient: JiraClient["Service"] = {
        ...defaultJiraClient,
        getMyPermissions: () => Effect.succeed({ ADMINISTER: { havePermission: true } }),
        searchProjectSpaces: () =>
          Stream.fromIterable([
            { key: "ENG", properties: { [spaceConfigurationPropertyKey]: { enabled: true } } },
          ]),
        approximateSearchCount: () => Effect.succeed(1),
        searchWorkItems: () =>
          Stream.fromIterable([
            {
              key: "ENG-1",
              properties: {
                [conversationLinksPropertyKey]: { count: 1, conversationIds: ["abc"] },
              },
            },
          ]),
      };
      const artifactWriterLayer = Layer.succeed(
        ArtifactWriterService,
        ArtifactWriterService.of({
          write: (requestedPath, records) =>
            records.pipe(
              Stream.runForEach((record) =>
                Effect.sync(() => {
                  writtenRecords.push(record);
                }),
              ),
              Effect.as(`memory:${requestedPath}`),
            ),
        }),
      );

      const exportServiceLayer = ExportService.layerNoDeps({
        source: "https://example.atlassian.net",
        user: "admin@example.com",
        apiToken: Redacted.make("secret"),
        out: "export.jsonl.gz",
        spaces: [],
        json: false,
      }).pipe(
        Layer.provide(
          Layer.mergeAll(artifactWriterLayer, Layer.succeed(JiraClient, JiraClient.of(jiraClient))),
        ),
      );

      const summary = yield* ExportService.use((service) => service.run).pipe(
        Effect.provide(Layer.mergeAll(exportServiceLayer, TestConsole.layer)),
      );

      expect(summary.outputPath).toBe("memory:export.jsonl.gz");
      expect(writtenRecords).toMatchObject([
        {
          type: "manifest",
          source: "https://example.atlassian.net",
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
      ]);
    }),
  );

  it.effect("exports discovered spaces to an artifact with aggregate summaries and warnings", () =>
    Effect.gen(function* () {
      const outputPath = yield* Effect.promise(() => tempPath("export.jsonl.gz"));
      const jiraClient: JiraClient["Service"] = {
        ...defaultJiraClient,
        getMyPermissions: () => Effect.succeed({ ADMINISTER: { havePermission: true } }),
        searchProjectSpaces: () =>
          Stream.fromIterable([
            { key: "ENG", properties: { [spaceConfigurationPropertyKey]: { enabled: true } } },
          ]),
        approximateSearchCount: () => Effect.succeed(7),
        searchWorkItems: () =>
          Stream.fromIterable([
            {
              key: "ENG-1",
              properties: {
                [conversationLinksPropertyKey]: {
                  count: 3,
                  conversationIds: ["abc", "def", "abc"],
                },
              },
            },
            {
              key: "ENG-2",
              properties: {
                [conversationLinksPropertyKey]: { count: 0, conversationIds: [] },
              },
            },
          ]),
      };

      const summary = yield* runExport(
        {
          source: "https://example.atlassian.net",
          user: "admin@example.com",
          apiToken: Redacted.make("secret"),
          out: outputPath,
          spaces: [],
          json: false,
        },
        jiraClient,
      );
      const warningLines = (yield* TestConsole.errorLines).map(String);

      expect(summary).toEqual({
        outputPath,
        source: "https://example.atlassian.net",
        approximateLinkedWorkItemCount: 7,
        spacesProcessed: 1,
        spaceConfigurationRecords: 1,
        workItemConversationLinkRecords: 1,
        conversationIds: 2,
        warningCount: 1,
        warningTruncated: false,
      });
      expect(warningLines.some((line) => line.includes("EMPTY_LINK_PROPERTY"))).toBe(true);

      const artifact = yield* inspectWrittenArtifact(outputPath);
      expect(artifact).toMatchObject({
        source: "https://example.atlassian.net",
        spacesProcessed: 1,
        spaceConfigurationRecords: 1,
        workItemConversationLinkRecords: 1,
        conversationIds: 2,
      });
    }).pipe(Effect.provide(TestConsole.layer)),
  );

  it.effect("writes to the next numbered output path when the requested file exists", () =>
    Effect.gen(function* () {
      const outputPath = yield* Effect.promise(() => tempPath("export.jsonl.gz"));
      const outputPath1 = outputPath.replace(/\.jsonl\.gz$/u, "1.jsonl.gz");
      const outputPath2 = outputPath.replace(/\.jsonl\.gz$/u, "2.jsonl.gz");
      yield* Effect.promise(() => writeFile(outputPath, "existing"));
      yield* Effect.promise(() => writeFile(outputPath1, "existing numbered"));
      const jiraClient: JiraClient["Service"] = {
        ...defaultJiraClient,
        getMyPermissions: () => Effect.succeed({ ADMINISTER: { havePermission: true } }),
        searchProjectSpaces: () =>
          Stream.fromIterable([
            { key: "ENG", properties: { [spaceConfigurationPropertyKey]: { enabled: true } } },
          ]),
        approximateSearchCount: () => Effect.succeed(1),
        searchWorkItems: () =>
          Stream.fromIterable([
            {
              key: "ENG-1",
              properties: {
                [conversationLinksPropertyKey]: { count: 1, conversationIds: ["abc"] },
              },
            },
          ]),
      };

      const summary = yield* runExport(
        {
          source: "https://example.atlassian.net",
          user: "admin@example.com",
          apiToken: Redacted.make("secret"),
          out: outputPath,
          spaces: [],
          json: false,
        },
        jiraClient,
      );

      expect(summary.outputPath).toBe(outputPath2);
      const artifact = yield* inspectWrittenArtifact(outputPath2);
      expect(artifact).toMatchObject({
        source: "https://example.atlassian.net",
        conversationIds: 1,
      });
      expect(yield* Effect.promise(() => readFile(outputPath, "utf8"))).toBe("existing");
      expect(yield* Effect.promise(() => readFile(outputPath1, "utf8"))).toBe("existing numbered");
    }).pipe(Effect.provide(TestConsole.layer)),
  );

  it.effect("exports legacy conversation-link arrays through the schema migration", () =>
    Effect.gen(function* () {
      const outputPath = yield* Effect.promise(() => tempPath("legacy-export.jsonl.gz"));
      const jiraClient: JiraClient["Service"] = {
        ...defaultJiraClient,
        getMyPermissions: () => Effect.succeed({ ADMINISTER: { havePermission: true } }),
        searchProjectSpaces: () =>
          Stream.fromIterable([
            { key: "ENG", properties: { [spaceConfigurationPropertyKey]: { enabled: true } } },
          ]),
        approximateSearchCount: () => Effect.succeed(1),
        searchWorkItems: () =>
          Stream.fromIterable([
            {
              key: "ENG-1",
              properties: {
                [conversationLinksPropertyKey]: [{ id: "abc" }, { id: "def" }, { id: "abc" }],
              },
            },
          ]),
      };

      const summary = yield* runExport(
        {
          source: "https://example.atlassian.net",
          user: "admin@example.com",
          apiToken: Redacted.make("secret"),
          out: outputPath,
          spaces: [],
          json: false,
        },
        jiraClient,
      );

      expect(summary.workItemConversationLinkRecords).toBe(1);
      expect(summary.conversationIds).toBe(2);
      const artifact = yield* inspectWrittenArtifact(outputPath);
      expect(artifact).toMatchObject({
        workItemConversationLinkRecords: 1,
        conversationIds: 2,
      });
    }).pipe(Effect.provide(TestConsole.layer)),
  );

  it.effect("fails and cleans up when a link property is malformed", () =>
    Effect.gen(function* () {
      const outputPath = yield* Effect.promise(() => tempPath("malformed-export.jsonl.gz"));
      const jiraClient: JiraClient["Service"] = {
        ...defaultJiraClient,
        getMyPermissions: () => Effect.succeed({ ADMINISTER: { havePermission: true } }),
        searchProjectSpaces: () =>
          Stream.fromIterable([
            { key: "ENG", properties: { [spaceConfigurationPropertyKey]: { enabled: true } } },
          ]),
        approximateSearchCount: () => Effect.succeed(1),
        searchWorkItems: () =>
          Stream.fromIterable([
            {
              key: "ENG-1",
              properties: {
                [conversationLinksPropertyKey]: { count: 1, conversationIds: [123] },
              },
            },
          ]),
      };

      const error = yield* runExport(
        {
          source: "https://example.atlassian.net",
          user: "admin@example.com",
          apiToken: Redacted.make("secret"),
          out: outputPath,
          spaces: [],
          json: false,
        },
        jiraClient,
      ).pipe(Effect.flip);
      const warningLines = (yield* TestConsole.errorLines).map(String);

      expect(error).toMatchObject({
        code: "export.malformedLinkProperty",
        context: {
          spaceKey: "ENG",
          workItemKey: "ENG-1",
        },
      });
      expect(warningLines.some((line) => line.includes("LINK_PROPERTY_MALFORMED"))).toBe(true);
      expect(warningLines.some((line) => line.includes("EMPTY_LINK_PROPERTY"))).toBe(false);
      expect(warningLines.some((line) => line.includes("currentSchemaError"))).toBe(true);
      expect(warningLines.some((line) => line.includes("legacySchemaError"))).toBe(true);
      yield* Effect.tryPromise(() => readFile(outputPath)).pipe(Effect.flip);
    }).pipe(Effect.provide(TestConsole.layer)),
  );
});
