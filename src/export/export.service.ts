import { Console, Context, Effect, Inspectable, Layer, Option, Schema, Stream } from "effect";

import { AppError, errorMessage } from "../errors.js";
import type { ExportConfig } from "../shared/config/index.js";
import { JiraClient } from "../shared/jira/index.js";
import { type ArtifactRecord, ArtifactWriterService } from "../shared/artifact/index.js";
import {
  ConversationLinkMigrationValue,
  LegacyConversationLinkPropertyValue,
} from "../shared/app/index.js";
import { formatWarning, type WarningCode, WarningCollector } from "../warnings.js";
import type { ExportSummary, LinkPropertyDecodeFailure, MutableCounts } from "./export.model.js";
import { type ExportJiraSpace, JiraService } from "./jira.service.js";

const emptyCounts = (): MutableCounts => ({
  spacesProcessed: 0,
  spaceConfigurationRecords: 0,
  workItemConversationLinkRecords: 0,
  conversationIds: 0,
});

const decodeJson = (value: unknown): Effect.Effect<Option.Option<typeof Schema.Json.Type>> =>
  Schema.decodeUnknownEffect(Schema.Json)(value).pipe(Effect.option);

const warn = (
  warnings: WarningCollector,
  code: WarningCode,
  context: Parameters<WarningCollector["add"]>[1] = {},
): Effect.Effect<void> =>
  Effect.sync(() => warnings.add(code, context)).pipe(
    Effect.flatMap((warning) => Console.error(formatWarning(warning))),
  );

const warningReason = (error: unknown): string => errorMessage(error);

interface ExportRecordPlan {
  readonly records: Stream.Stream<ArtifactRecord, AppError>;
  readonly approximateCount: Option.Option<number>;
}

const exportProgram = (
  config: ExportConfig,
): Effect.Effect<ExportSummary, AppError, ArtifactWriterService | JiraService> =>
  Effect.gen(function* () {
    const jiraService = yield* JiraService;
    const artifactWriter = yield* ArtifactWriterService;
    const warnings = new WarningCollector(100);

    const counts = emptyCounts();
    const plan = yield* planExportRecords(config, jiraService, warnings, counts);
    const outputPath = yield* artifactWriter.write(config.out, plan.records);

    return exportSummary({ ...config, out: outputPath }, counts, warnings, plan.approximateCount);
  });

const planExportRecords = (
  config: ExportConfig,
  jiraService: JiraService["Service"],
  warnings: WarningCollector,
  counts: MutableCounts,
): Effect.Effect<ExportRecordPlan, AppError> =>
  Effect.gen(function* () {
    yield* Console.error(
      `Verifying Jira global admin permission for export source ${config.source}`,
    );
    yield* jiraService.verifyGlobalAdmin;

    const spaces = yield* resolveSpaces(config, jiraService, warnings);
    const spaceKeys = spaces.map((space) => space.key);
    if (spaceKeys.length === 0) {
      const explicitSpacesProvided = config.spaces.length > 0;
      const errorCode = explicitSpacesProvided
        ? "export.emptyExplicitScope"
        : "export.emptyDefaultScope";
      const errorMessage = explicitSpacesProvided
        ? `Nothing to export: none of the explicitly provided spaces (${config.spaces.join(", ")}) were found or have accessible work items.`
        : "Nothing to export: no spaces with Intercom configuration were discovered. Pass --space to select spaces explicitly.";
      return yield* new AppError(errorCode, errorMessage);
    }

    yield* Console.error("Counting linked work items approximately");
    const approximateCount = yield* jiraService.approximateLinkedWorkItemCount(spaceKeys).pipe(
      Effect.map(Option.some),
      Effect.catch((error) =>
        warn(warnings, "APPROXIMATE_COUNT_FAILED", {
          reason: warningReason(error),
        }).pipe(Effect.as(Option.none<number>())),
      ),
    );

    const records = Stream.succeed<ArtifactRecord>({
      type: "manifest",
      createdAt: new Date().toISOString(),
      source: config.source,
    }).pipe(
      Stream.concat(
        Stream.fromIterable(spaces).pipe(
          Stream.flatMap((space) =>
            exportSpaceRecords(config, space, jiraService, warnings, counts),
          ),
        ),
      ),
    );

    return { records, approximateCount };
  });

const exportSummary = (
  config: ExportConfig,
  counts: MutableCounts,
  warnings: WarningCollector,
  approximateCount: Option.Option<number>,
): ExportSummary => {
  const warningSummary = warnings.summary();
  const summaryBase = {
    outputPath: config.out,
    source: config.source,
    spacesProcessed: counts.spacesProcessed,
    spaceConfigurationRecords: counts.spaceConfigurationRecords,
    workItemConversationLinkRecords: counts.workItemConversationLinkRecords,
    conversationIds: counts.conversationIds,
    warningCount: warningSummary.count,
    warningTruncated: warningSummary.truncated,
  };
  return Option.isNone(approximateCount)
    ? summaryBase
    : { ...summaryBase, approximateLinkedWorkItemCount: approximateCount.value };
};

const resolveSpaces = (
  config: ExportConfig,
  jiraService: JiraService["Service"],
  warnings: WarningCollector,
): Effect.Effect<readonly ExportJiraSpace[], AppError> => {
  if (config.spaces.length > 0) {
    return jiraService.validateSpaces(config.spaces);
  }

  return jiraService.discoverConfiguredSpaces.pipe(
    Effect.catch((error) =>
      warn(warnings, "DEFAULT_SCOPE_DISCOVERY_FAILED", {
        reason: warningReason(error),
      }).pipe(Effect.as([])),
    ),
  );
};

const exportSpaceRecords = (
  config: ExportConfig,
  space: ExportJiraSpace,
  jiraService: JiraService["Service"],
  warnings: WarningCollector,
  counts: MutableCounts,
): Stream.Stream<ArtifactRecord, AppError> =>
  Stream.unwrap(
    Effect.gen(function* () {
      yield* Console.error(`Exporting space ${space.key}`);
      counts.spacesProcessed += 1;
      const beforeConfig = counts.spaceConfigurationRecords;
      const beforeLinks = counts.workItemConversationLinkRecords;

      const records = exportSpaceConfigurationRecord(space, warnings, counts).pipe(
        Stream.concat(exportSpaceLinkRecords(space.key, jiraService, warnings, counts)),
        Stream.concat(
          Stream.fromEffect(
            Effect.suspend(() =>
              config.spaces.length > 0 &&
              beforeConfig === counts.spaceConfigurationRecords &&
              beforeLinks === counts.workItemConversationLinkRecords
                ? warn(warnings, "EMPTY_EXPLICIT_SPACE", { spaceKey: space.key })
                : Effect.void,
            ),
          ).pipe(Stream.drain),
        ),
      );

      return records;
    }),
  );

const exportSpaceConfigurationRecord = (
  space: ExportJiraSpace,
  warnings: WarningCollector,
  counts: MutableCounts,
): Stream.Stream<ArtifactRecord, AppError> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const configuration = space.configuration ?? Option.none<unknown>();
      if (Option.isNone(configuration)) {
        return Stream.empty;
      }

      const jsonConfiguration = yield* decodeJson(configuration.value);
      if (Option.isNone(jsonConfiguration)) {
        yield* warn(warnings, "CONFIGURATION_MALFORMED", { spaceKey: space.key });
        return Stream.empty;
      }

      counts.spaceConfigurationRecords += 1;
      return Stream.succeed<ArtifactRecord>({
        type: "spaceConfiguration",
        spaceKey: space.key,
        configuration: jsonConfiguration.value,
      });
    }),
  );

const decodeLinkProperty = (
  value: unknown,
): Effect.Effect<ConversationLinkMigrationValue, LinkPropertyDecodeFailure> =>
  Schema.decodeUnknownEffect(ConversationLinkMigrationValue)(value).pipe(
    Effect.catch((currentSchemaError) =>
      Schema.decodeUnknownEffect(LegacyConversationLinkPropertyValue)(value).pipe(
        Effect.mapError((legacySchemaError) => ({ currentSchemaError, legacySchemaError })),
      ),
    ),
  );

const warnMalformedLinkProperty = (
  warnings: WarningCollector,
  spaceKey: string,
  workItemKey: string,
  failure: LinkPropertyDecodeFailure,
): Effect.Effect<void> =>
  warn(warnings, "LINK_PROPERTY_MALFORMED", {
    spaceKey,
    workItemKey,
    currentSchemaError: Inspectable.toStringUnknown(failure.currentSchemaError),
    legacySchemaError: Inspectable.toStringUnknown(failure.legacySchemaError),
  });

const exportSpaceLinkRecords = (
  spaceKey: string,
  jiraService: JiraService["Service"],
  warnings: WarningCollector,
  counts: MutableCounts,
): Stream.Stream<ArtifactRecord, AppError> =>
  jiraService.searchWorkItemConversationLinks(spaceKey).pipe(
    Stream.mapEffect((hit) =>
      Effect.gen(function* () {
        const maybeLinkProperty = yield* decodeLinkProperty(hit.propertyValue).pipe(
          Effect.matchEffect({
            onFailure: (failure) =>
              Effect.gen(function* () {
                yield* warnMalformedLinkProperty(warnings, spaceKey, hit.key, failure);
                return yield* new AppError(
                  "export.malformedLinkProperty",
                  `Malformed conversation-link property on work item ${spaceKey}/${hit.key}. Unable to decode as current or legacy format.`,
                  {
                    context: {
                      spaceKey,
                      workItemKey: hit.key,
                      currentSchemaError: Inspectable.toStringUnknown(failure.currentSchemaError),
                      legacySchemaError: Inspectable.toStringUnknown(failure.legacySchemaError),
                    },
                    cause: failure,
                  },
                );
              }),
            onSuccess: (linkProperty) => Effect.succeed(Option.some(linkProperty)),
          }),
        );
        if (Option.isNone(maybeLinkProperty)) {
          return Option.none<ArtifactRecord>();
        }
        if (maybeLinkProperty.value.conversationIds.size === 0) {
          yield* warn(warnings, "EMPTY_LINK_PROPERTY", {
            spaceKey,
            workItemKey: hit.key,
          });
          return Option.none<ArtifactRecord>();
        }
        const conversationIds = [...maybeLinkProperty.value.conversationIds];
        counts.workItemConversationLinkRecords += 1;
        counts.conversationIds += conversationIds.length;
        return Option.some<ArtifactRecord>({
          type: "workItemConversationLinks",
          spaceKey,
          workItemKey: hit.key,
          conversationIds,
        });
      }),
    ),
    Stream.flatMap((record) =>
      Option.isSome(record) ? Stream.succeed(record.value) : Stream.empty,
    ),
  );

export class ExportService extends Context.Service<
  ExportService,
  {
    readonly run: Effect.Effect<ExportSummary, AppError>;
  }
>()("ifj/ExportService") {
  static readonly layerNoDeps = (
    config: ExportConfig,
  ): Layer.Layer<ExportService, never, ArtifactWriterService | JiraClient> =>
    Layer.effect(
      ExportService,
      Effect.gen(function* () {
        const jiraService = yield* JiraService;
        const artifactWriter = yield* ArtifactWriterService;
        return ExportService.of({
          run: exportProgram(config).pipe(
            Effect.provideService(JiraService, jiraService),
            Effect.provideService(ArtifactWriterService, artifactWriter),
          ),
        });
      }),
    ).pipe(Layer.provide(JiraService.layer));

  static readonly layer = (config: ExportConfig) =>
    ExportService.layerNoDeps(config).pipe(
      Layer.provide(
        Layer.mergeAll(
          ArtifactWriterService.layer,
          JiraClient.layer({
            siteUrl: config.source,
            user: config.user,
            apiToken: config.apiToken,
          }),
        ),
      ),
    );
}
