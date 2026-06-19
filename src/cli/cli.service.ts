import { NodeServices } from "@effect/platform-node";
import { ConfigProvider, Console, Context, Effect, Layer } from "effect";
import { Argument, type CliError, Command, Flag } from "effect/unstable/cli";

import {
  apiTokenConfig,
  type ExportConfig,
  importApiTokenConfig,
  importArtifactPathConfig,
  type ImportConfig,
  importSpacesConfig,
  importUserConfig,
  inspectArtifactPathConfig,
  JiraCloudSource,
  normalizeSpaceList,
  outConfig,
  RedactedNonEmptyString,
  runtimeConfigProvider,
  sourceConfig,
  spacesConfig,
  targetConfig,
  TrimmedNonEmptyString,
  userConfig,
} from "../shared/config/index.js";
import type { AppError } from "../errors.js";
import { ExportService, formatExportSummary } from "../export/index.js";
import { formatImportSummary, ImportService } from "../import/index.js";
import { formatInspectSummary, InspectService } from "../inspect/index.js";

type ExportServiceLayerFactory = (
  config: ExportConfig,
) => Layer.Layer<ExportService, never, NodeServices.NodeServices>;
type ImportServiceLayerFactory = (
  config: ImportConfig,
) => Layer.Layer<ImportService, never, NodeServices.NodeServices>;

const formatJson = (value: unknown): string => JSON.stringify(value, null, 2);

const inspectCommand = Command.make(
  "inspect",
  {
    artifactPath: Argument.string("artifact").pipe(
      Argument.withSchema(TrimmedNonEmptyString),
      Argument.withFallbackConfig(inspectArtifactPathConfig),
    ),
    json: Flag.boolean("json"),
  },
  (config) =>
    InspectService.use((service) => service.run(config.artifactPath)).pipe(
      Effect.flatMap((summary) =>
        Console.log(config.json ? formatJson(summary) : formatInspectSummary(summary)),
      ),
    ),
).pipe(Command.withShortDescription("Validate and summarize an export artifact"));

const exportCommand = Command.make(
  "export",
  {
    source: Flag.string("source").pipe(
      Flag.withSchema(JiraCloudSource),
      Flag.withFallbackConfig(sourceConfig),
    ),
    user: Flag.string("user").pipe(
      Flag.withSchema(TrimmedNonEmptyString),
      Flag.withFallbackConfig(userConfig),
    ),
    apiToken: Flag.redacted("api-token").pipe(
      Flag.withSchema(RedactedNonEmptyString),
      Flag.withFallbackConfig(apiTokenConfig),
    ),
    out: Flag.string("out").pipe(
      Flag.withSchema(TrimmedNonEmptyString),
      Flag.withFallbackConfig(outConfig),
    ),
    spaces: Flag.string("space").pipe(
      Flag.between(1, 1_000),
      Flag.map(normalizeSpaceList),
      Flag.withFallbackConfig(spacesConfig),
    ),
    json: Flag.boolean("json"),
  },
  (config) =>
    ExportService.use((service) => service.run).pipe(
      Effect.flatMap((summary) =>
        Console.log(config.json ? formatJson(summary) : formatExportSummary(summary)),
      ),
    ),
).pipe(Command.withShortDescription("Export Intercom for Jira data"));

const importCommand = Command.make(
  "import",
  {
    artifactPath: Argument.string("artifact").pipe(
      Argument.withSchema(TrimmedNonEmptyString),
      Argument.withFallbackConfig(importArtifactPathConfig),
    ),
    target: Flag.string("target").pipe(
      Flag.withSchema(JiraCloudSource),
      Flag.withFallbackConfig(targetConfig),
    ),
    user: Flag.string("user").pipe(
      Flag.withSchema(TrimmedNonEmptyString),
      Flag.withFallbackConfig(importUserConfig),
    ),
    apiToken: Flag.redacted("api-token").pipe(
      Flag.withSchema(RedactedNonEmptyString),
      Flag.withFallbackConfig(importApiTokenConfig),
    ),
    spaces: Flag.string("space").pipe(
      Flag.between(1, 1_000),
      Flag.map(normalizeSpaceList),
      Flag.withFallbackConfig(importSpacesConfig),
    ),
    json: Flag.boolean("json"),
  },
  (config) =>
    ImportService.use((service) => service.run).pipe(
      Effect.flatMap((summary) =>
        Console.log(config.json ? formatJson(summary) : formatImportSummary(summary)),
      ),
    ),
).pipe(Command.withShortDescription("Import Intercom for Jira data into a target Jira site"));

const makeCommand = (
  exportServiceLayer: ExportServiceLayerFactory,
  importServiceLayer: ImportServiceLayerFactory,
) =>
  Command.make("ifj").pipe(
    Command.withDescription("Intercom for Jira migration CLI"),
    Command.withSubcommands([
      exportCommand.pipe(Command.provide((config) => exportServiceLayer(config))),
      importCommand.pipe(Command.provide((config) => importServiceLayer(config))),
      inspectCommand,
    ]),
  );

const runProgram = (
  args: readonly string[],
  exportServiceLayer: ExportServiceLayerFactory,
  importServiceLayer: ImportServiceLayerFactory,
): Effect.Effect<void, AppError | CliError.CliError, NodeServices.NodeServices | InspectService> =>
  runtimeConfigProvider.pipe(
    Effect.flatMap((provider) =>
      Command.runWith(makeCommand(exportServiceLayer, importServiceLayer), { version: "0.1.0" })(
        args,
      ).pipe(Effect.provideService(ConfigProvider.ConfigProvider, provider)),
    ),
  );

export class CliService extends Context.Service<
  CliService,
  {
    readonly run: (args: readonly string[]) => Effect.Effect<void, AppError | CliError.CliError>;
  }
>()("ifj/CliService") {
  static readonly layerNoDeps = (
    exportServiceLayer: ExportServiceLayerFactory,
    importServiceLayer: ImportServiceLayerFactory,
  ): Layer.Layer<CliService, never, NodeServices.NodeServices | InspectService> =>
    Layer.effect(
      CliService,
      Effect.context<NodeServices.NodeServices | InspectService>().pipe(
        Effect.map((context) =>
          CliService.of({
            run: (args) =>
              runProgram(args, exportServiceLayer, importServiceLayer).pipe(
                Effect.provide(context),
              ),
          }),
        ),
      ),
    );

  static readonly layer: Layer.Layer<CliService> = CliService.layerNoDeps(
    ExportService.layer,
    ImportService.layer,
  ).pipe(Layer.provide(InspectService.layer.pipe(Layer.provideMerge(NodeServices.layer))));
}
