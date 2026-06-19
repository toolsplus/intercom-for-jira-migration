import { NodeServices } from "@effect/platform-node";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigProvider, Effect, Layer, Stream } from "effect";
import { TestConsole } from "effect/testing";
import { describe, expect, it } from "@effect/vitest";

import { CliService } from "./cli/index.js";
import { ExportService } from "./export/index.js";
import { InspectService } from "./inspect/index.js";
import { ImportService } from "./import/index.js";
import { conversationLinksPropertyKey, spaceConfigurationPropertyKey } from "./shared/app/index.js";
import { JiraClient } from "./shared/jira/index.js";
import { type ArtifactRecord, ArtifactWriterService } from "./shared/artifact/index.js";

const tempPath = async (name: string) => join(await mkdtemp(join(tmpdir(), "ifj-")), name);
const artifactWriterLayer = ArtifactWriterService.layer.pipe(Layer.provide(NodeServices.layer));
const inspectLayer = InspectService.layer.pipe(Layer.provide(NodeServices.layer));
const inspectWrittenArtifact = (path: string) =>
  InspectService.use((service) => service.run(path)).pipe(Effect.provide(inspectLayer));
const writeArtifactFixture = (path: string, records: readonly ArtifactRecord[]) =>
  ArtifactWriterService.use((service) => service.write(path, Stream.fromIterable(records))).pipe(
    Effect.provide(artifactWriterLayer),
  );
const runCli = (args: readonly string[]) => CliService.use((cli) => cli.run(args));
const linkedWorkItemStream = () =>
  Stream.fromIterable([
    {
      key: "ENG-1",
      properties: {
        [conversationLinksPropertyKey]: { count: 1, conversationIds: ["abc"] },
      },
    },
  ]);

const defaultJiraClient: JiraClient["Service"] = {
  getMyPermissions: () => Effect.succeed({ ADMINISTER: { havePermission: true } }),
  searchProjectSpaces: () =>
    Stream.fromIterable([
      {
        key: "ENG",
        properties: { [spaceConfigurationPropertyKey]: { enabled: true } },
      },
    ]),
  approximateSearchCount: () => Effect.succeed(1),
  searchWorkItems: linkedWorkItemStream,
  writeProjectProperty: () => Effect.void,
  bulkFetchWorkItems: () => Effect.succeed([]),
  submitIssuePropertyBulkTask: () =>
    Effect.succeed("https://example.atlassian.net/rest/api/3/task/task-1"),
  getTask: () => Effect.succeed({ status: "COMPLETE" }),
};

const exportServiceLayerFromClient =
  (jiraClient: JiraClient["Service"]) => (config: Parameters<typeof ExportService.layer>[0]) =>
    ExportService.layerNoDeps(config).pipe(
      Layer.provide(
        Layer.mergeAll(artifactWriterLayer, Layer.succeed(JiraClient, JiraClient.of(jiraClient))),
      ),
    );

const cliEnvironmentLayer = <ConfigError = never, ConfigServices = never>(
  configProviderLayer: Layer.Layer<never, ConfigError, ConfigServices> = Layer.empty,
): Layer.Layer<NodeServices.NodeServices | InspectService, ConfigError, ConfigServices> =>
  Layer.mergeAll(InspectService.layer, configProviderLayer).pipe(
    Layer.provideMerge(NodeServices.layer),
  );

const cliLayerFromExportServiceLayer = <ConfigError = never, ConfigServices = never>(
  exportServiceLayer: (
    config: Parameters<typeof ExportService.layer>[0],
  ) => Layer.Layer<ExportService, never, NodeServices.NodeServices>,
  configProviderLayer: Layer.Layer<never, ConfigError, ConfigServices> = Layer.empty,
  importServiceLayer: (
    config: Parameters<typeof ImportService.layer>[0],
  ) => Layer.Layer<ImportService, never, NodeServices.NodeServices> = ImportService.layer,
) =>
  CliService.layerNoDeps(exportServiceLayer, importServiceLayer).pipe(
    Layer.provideMerge(Layer.mergeAll(TestConsole.layer, cliEnvironmentLayer(configProviderLayer))),
  );

describe("CLI", () => {
  it.effect("exports through the CLI with a provided Jira client layer", () =>
    Effect.gen(function* () {
      const cwd = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "ifj-cli-export-")));
      const outputPath = join(cwd, "cli-export.jsonl.gz");

      yield* runCli([
        "export",
        "--source",
        "https://example.atlassian.net",
        "--user",
        "admin@example.com",
        "--api-token",
        "secret",
        "--out",
        outputPath,
      ]);
      const stdout = yield* TestConsole.logLines;

      expect(stdout.join("\n")).toContain("Export complete");
      const artifact = yield* inspectWrittenArtifact(outputPath);
      expect(artifact).toMatchObject({
        source: "https://example.atlassian.net",
        conversationIds: 1,
      });
    }).pipe(
      Effect.provide(
        cliLayerFromExportServiceLayer(
          exportServiceLayerFromClient(defaultJiraClient),
          ConfigProvider.layer(
            ConfigProvider.fromEnv({
              env: {
                EXPORT_SOURCE: "https://ignored.atlassian.net",
                EXPORT_USER: "ignored@example.com",
                EXPORT_API_TOKEN: "ignored",
                EXPORT_OUT: join(tmpdir(), "ignored.jsonl.gz"),
              },
            }),
          ),
        ),
      ),
    ),
  );

  it.effect("falls back to export config when export flags are omitted", () =>
    Effect.gen(function* () {
      const cwd = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "ifj-cli-export-env-")));
      const outputPath = join(cwd, "cli-export-env.jsonl.gz");
      const jiraClient: JiraClient["Service"] = {
        ...defaultJiraClient,
        searchProjectSpaces: (params) =>
          params.keys === undefined
            ? Stream.die("explicit spaces should be validated")
            : Stream.fromIterable(
                params.keys.map((key) => ({
                  key,
                  properties: { [spaceConfigurationPropertyKey]: { enabled: true } },
                })),
              ),
      };

      yield* Effect.gen(function* () {
        yield* runCli(["export"]);
        const stdout = yield* TestConsole.logLines;

        expect(stdout.join("\n")).toContain("Export complete");
        const artifact = yield* inspectWrittenArtifact(outputPath);
        expect(artifact).toMatchObject({
          source: "https://env.atlassian.net",
          spacesProcessed: 1,
        });
      }).pipe(
        Effect.provide(
          cliLayerFromExportServiceLayer(
            exportServiceLayerFromClient(jiraClient),
            ConfigProvider.layer(
              ConfigProvider.fromEnv({
                env: {
                  EXPORT_SOURCE: "https://env.atlassian.net/browse/ENG-1",
                  EXPORT_USER: "admin@example.com",
                  EXPORT_API_TOKEN: "secret",
                  EXPORT_OUT: outputPath,
                  EXPORT_SPACES: "ENG",
                },
              }),
            ),
          ),
        ),
      );
    }),
  );

  it.effect("inspects an artifact and writes a human summary to stdout", () =>
    Effect.gen(function* () {
      const path = yield* Effect.promise(() => tempPath("cli.jsonl.gz"));
      yield* writeArtifactFixture(path, [
        {
          type: "manifest",
          createdAt: "2026-06-05T00:00:00.000Z",
          source: "https://example.atlassian.net",
        },
      ]);

      yield* runCli(["inspect", path]);
      const stdout = yield* TestConsole.logLines;

      expect(stdout.join("\n")).toContain("Artifact valid");
      expect(stdout.join("\n")).toContain("Source: https://example.atlassian.net");
    }).pipe(Effect.provide(cliLayerFromExportServiceLayer(ExportService.layer))),
  );

  it.effect("falls back to inspect config without loading export config", () =>
    Effect.gen(function* () {
      const path = yield* Effect.promise(() => tempPath("cli-inspect-env.jsonl.gz"));
      yield* writeArtifactFixture(path, [
        {
          type: "manifest",
          createdAt: "2026-06-05T00:00:00.000Z",
          source: "https://inspect.atlassian.net",
        },
      ]);

      yield* Effect.gen(function* () {
        yield* runCli(["inspect"]);
        const stdout = yield* TestConsole.logLines;

        expect(stdout.join("\n")).toContain("Artifact valid");
        expect(stdout.join("\n")).toContain("Source: https://inspect.atlassian.net");
      }).pipe(
        Effect.provide(
          cliLayerFromExportServiceLayer(
            ExportService.layer,
            ConfigProvider.layer(
              ConfigProvider.fromEnv({
                env: {
                  EXPORT_SOURCE: "not a jira cloud url",
                  INSPECT_ARTIFACT_PATH: path,
                },
              }),
            ),
          ),
        ),
      );
    }),
  );

  it.effect("imports through the CLI with target flags and artifact path fallback", () => {
    const importConfigs: Parameters<typeof ImportService.layer>[0][] = [];
    const importServiceLayer = (config: Parameters<typeof ImportService.layer>[0]) => {
      importConfigs.push(config);
      return Layer.succeed(
        ImportService,
        ImportService.of({
          run: Effect.succeed({
            source: "https://source.atlassian.net",
            target: config.target,
            selectedSpaces: config.spaces,
            spacesImported: 1,
            spaceConfigurationsWritten: 1,
            workItemLinkRecordsImported: 0,
            conversationIdsImported: 0,
            warningCount: 0,
            skippedSpaceCount: 0,
            failedSpaceConfigurationCount: 0,
            skippedWorkItemLinkCount: 0,
            failedWorkItemLinkBatchCount: 0,
            warnings: [],
            skippedSpaces: [],
            failedSpaceConfigurations: [],
            skippedWorkItemLinks: [],
            failedWorkItemLinkBatches: [],
            detailsTruncated: false,
          }),
        }),
      );
    };

    return Effect.gen(function* () {
      yield* runCli([
        "import",
        "--target",
        "https://target.atlassian.net/browse/ENG-1",
        "--user",
        "admin@example.com",
        "--api-token",
        "secret",
        "--space",
        "eng",
        "--space",
        "OPS",
      ]);

      const stdout = yield* TestConsole.logLines;
      expect(stdout.join("\n")).toContain("Import complete");
      expect(importConfigs).toMatchObject([
        {
          target: "https://target.atlassian.net",
          artifactPath: "from-env.jsonl.gz",
          spaces: ["ENG", "OPS"],
          json: false,
        },
      ]);
    }).pipe(
      Effect.provide(
        cliLayerFromExportServiceLayer(
          ExportService.layer,
          ConfigProvider.layer(
            ConfigProvider.fromEnv({
              env: {
                IMPORT_ARTIFACT_PATH: "from-env.jsonl.gz",
              },
            }),
          ),
          importServiceLayer,
        ),
      ),
    );
  });
});
