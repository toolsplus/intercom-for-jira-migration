import type { NodeServices } from "@effect/platform-node";
import { Array as Arr, Console, Context, Duration, Effect, Layer, Result, Stream } from "effect";

import { errorMessage } from "../errors.js";
import type { AppError } from "../errors.js";
import { ArtifactReaderService } from "../shared/artifact/index.js";
import type { WorkItemConversationLinksRecord } from "../shared/artifact/index.js";
import type { ImportConfig } from "../shared/config/index.js";
import { JiraClient } from "../shared/jira/index.js";
import type { JiraIssuePropertyUpdate } from "../shared/jira/index.js";
import { assessImportPlan } from "./import.plan.js";
import type {
  FailedSpaceConfiguration,
  FailedWorkItemLinkBatch,
  ImportPlan,
  ImportSpacePlan,
  ImportSummary,
  SkippedSpace,
  SkippedWorkItemLink,
} from "./import.model.js";
import { ImportJiraService } from "./jira.service.js";

const detailLimit = 100;
const workItemLinkBatchSize = 100;

interface MutableImportState {
  spacesImported: number;
  spaceConfigurationsWritten: number;
  workItemLinkRecordsImported: number;
  conversationIdsImported: number;
  detailsTruncated: boolean;
  skippedSpaces: SkippedSpace[];
  failedSpaceConfigurations: FailedSpaceConfiguration[];
  skippedWorkItemLinks: SkippedWorkItemLink[];
  failedWorkItemLinkBatches: FailedWorkItemLinkBatch[];
}

const emptyState = (plan: ImportPlan): MutableImportState => ({
  spacesImported: 0,
  spaceConfigurationsWritten: 0,
  workItemLinkRecordsImported: 0,
  conversationIdsImported: 0,
  detailsTruncated: false,
  skippedSpaces: [...plan.skippedSpaces],
  failedSpaceConfigurations: [],
  skippedWorkItemLinks: [],
  failedWorkItemLinkBatches: [],
});

const pushDetail = <A>(items: A[], item: A, state: MutableImportState): void => {
  if (items.length < detailLimit) {
    items.push(item);
    return;
  }
  state.detailsTruncated = true;
};

const unavailableTargetSpace = (spaceKey: string): SkippedSpace => ({
  spaceKey,
  reason: "target-space-unavailable",
  message: `Target space ${spaceKey} is missing or inaccessible.`,
});

const summaryFromState = (plan: ImportPlan, state: MutableImportState): ImportSummary => ({
  source: plan.source,
  target: plan.target,
  selectedSpaces: plan.selectedSpaceKeys,
  spacesImported: state.spacesImported,
  spaceConfigurationsWritten: state.spaceConfigurationsWritten,
  workItemLinkRecordsImported: state.workItemLinkRecordsImported,
  conversationIdsImported: state.conversationIdsImported,
  warningCount: plan.warnings.length,
  skippedSpaceCount: state.skippedSpaces.length,
  failedSpaceConfigurationCount: state.failedSpaceConfigurations.length,
  skippedWorkItemLinkCount: state.skippedWorkItemLinks.length,
  failedWorkItemLinkBatchCount: state.failedWorkItemLinkBatches.length,
  warnings: plan.warnings.slice(0, detailLimit),
  skippedSpaces: state.skippedSpaces.slice(0, detailLimit),
  failedSpaceConfigurations: state.failedSpaceConfigurations.slice(0, detailLimit),
  skippedWorkItemLinks: state.skippedWorkItemLinks.slice(0, detailLimit),
  failedWorkItemLinkBatches: state.failedWorkItemLinkBatches.slice(0, detailLimit),
  detailsTruncated:
    state.detailsTruncated ||
    plan.warnings.length > detailLimit ||
    state.skippedSpaces.length > detailLimit ||
    state.failedSpaceConfigurations.length > detailLimit ||
    state.skippedWorkItemLinks.length > detailLimit ||
    state.failedWorkItemLinkBatches.length > detailLimit,
});

const applySpaceConfigurations = (
  space: ImportSpacePlan,
  jiraService: ImportJiraService["Service"],
  state: MutableImportState,
): Effect.Effect<void> =>
  Effect.forEach(
    space.configurationRecords,
    (record) =>
      jiraService.writeSpaceConfiguration(space.spaceKey, record.configuration).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            state.spaceConfigurationsWritten += 1;
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => {
            pushDetail(
              state.failedSpaceConfigurations,
              { spaceKey: space.spaceKey, reason: errorMessage(error) },
              state,
            );
          }),
        ),
      ),
    { discard: true },
  );

const skippedMissingWorkItem = (record: WorkItemConversationLinksRecord): SkippedWorkItemLink => ({
  spaceKey: record.spaceKey,
  workItemKey: record.workItemKey,
  reason: "missing-target-work-item",
  message: `Target work item ${record.workItemKey} is missing, inaccessible, or may have been moved.`,
});

const skippedMismatchedWorkItem = (
  record: WorkItemConversationLinksRecord,
  resolvedKey: string,
): SkippedWorkItemLink => ({
  spaceKey: record.spaceKey,
  workItemKey: record.workItemKey,
  reason: "target-key-mismatch",
  message: `Target work item ${record.workItemKey} resolved to ${resolvedKey}.`,
});

const writeLinkBatch = (
  spaceKey: string,
  batchNumber: number,
  totalBatches: number,
  records: readonly WorkItemConversationLinksRecord[],
  jiraService: ImportJiraService["Service"],
  state: MutableImportState,
): Effect.Effect<void> =>
  Effect.suspend(() => {
    const batchStartedAt = Date.now();
    const failedBatch = (error: unknown) =>
      Console.error(
        `Import batch ${String(batchNumber)}/${String(
          totalBatches,
        )} for space ${spaceKey}: failed after ${Duration.format(
          Duration.millis(Date.now() - batchStartedAt),
        )}: ${errorMessage(error)}.`,
      ).pipe(
        Effect.andThen(
          Effect.sync(() => {
            pushDetail(
              state.failedWorkItemLinkBatches,
              { spaceKey, batchNumber, reason: errorMessage(error) },
              state,
            );
          }),
        ),
      );

    return Effect.gen(function* () {
      const resolved = yield* jiraService.resolveWorkItems(
        records.map((record) => record.workItemKey),
      );
      const byRequestedKey = new Map(resolved.map((item) => [item.requestedKey, item]));
      const conversationLinkPropertyUpdates = Arr.filterMap(records, (record) => {
        const workItem = byRequestedKey.get(record.workItemKey);
        if (workItem === undefined) {
          pushDetail(state.skippedWorkItemLinks, skippedMissingWorkItem(record), state);
          return Result.failVoid;
        } else if (workItem.key !== record.workItemKey) {
          pushDetail(
            state.skippedWorkItemLinks,
            skippedMismatchedWorkItem(record, workItem.key),
            state,
          );
          return Result.failVoid;
        }

        const conversationIds = Arr.dedupe(record.conversationIds);
        return Result.succeed({
          issueId: workItem.id,
          value: {
            count: conversationIds.length,
            conversationIds,
          },
        } satisfies JiraIssuePropertyUpdate);
      });

      if (conversationLinkPropertyUpdates.length === 0) {
        yield* Console.error(
          `Import batch ${String(batchNumber)}/${String(
            totalBatches,
          )} for space ${spaceKey}: skipped records=${String(records.length)} in ${Duration.format(
            Duration.millis(Date.now() - batchStartedAt),
          )}; no Jira write needed.`,
        );
        return;
      }

      yield* jiraService
        .writeWorkItemConversationLinks(spaceKey, conversationLinkPropertyUpdates)
        .pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              state.workItemLinkRecordsImported += conversationLinkPropertyUpdates.length;
              state.conversationIdsImported += Arr.reduce(
                conversationLinkPropertyUpdates,
                0,
                (sum, propertyUpdate) => sum + propertyUpdate.value.count,
              );
            }),
          ),
          Effect.tap(() =>
            Console.error(
              `Import batch ${String(batchNumber)}/${String(
                totalBatches,
              )} for space ${spaceKey}: importedRecords=${String(
                conversationLinkPropertyUpdates.length,
              )}, records=${String(records.length)}, conversationIds=${String(
                Arr.reduce(
                  conversationLinkPropertyUpdates,
                  0,
                  (sum, propertyUpdate) => sum + propertyUpdate.value.count,
                ),
              )} in ${Duration.format(Duration.millis(Date.now() - batchStartedAt))}.`,
            ),
          ),
        );
    }).pipe(Effect.catch(failedBatch));
  });

const applyWorkItemLinks = (
  space: ImportSpacePlan,
  jiraService: ImportJiraService["Service"],
  state: MutableImportState,
): Effect.Effect<void> => {
  const batches = Arr.chunksOf(space.workItemLinkRecords, workItemLinkBatchSize);
  return Effect.forEach(
    batches,
    (batch, index) =>
      writeLinkBatch(space.spaceKey, index + 1, batches.length, batch, jiraService, state),
    { discard: true },
  );
};

const applySpace = (
  space: ImportSpacePlan,
  jiraService: ImportJiraService["Service"],
  state: MutableImportState,
): Effect.Effect<void, AppError> =>
  Effect.gen(function* () {
    const workItemLinkBatches = Math.ceil(space.workItemLinkRecords.length / workItemLinkBatchSize);
    yield* Console.error(
      `Importing space ${space.spaceKey}: configurationRecords=${String(
        space.configurationRecords.length,
      )}, workItemLinkRecords=${String(space.workItemLinkRecords.length)}, batches=${String(
        workItemLinkBatches,
      )}, batchSize=${String(workItemLinkBatchSize)}.`,
    );
    const available = yield* jiraService.targetSpaceAvailable(space.spaceKey);
    if (!available) {
      pushDetail(state.skippedSpaces, unavailableTargetSpace(space.spaceKey), state);
      return;
    }

    state.spacesImported += 1;
    yield* applySpaceConfigurations(space, jiraService, state);
    yield* applyWorkItemLinks(space, jiraService, state);
  });

const importProgram = (
  config: ImportConfig,
): Effect.Effect<ImportSummary, AppError, ArtifactReaderService | ImportJiraService> =>
  Effect.gen(function* () {
    const artifactReader = yield* ArtifactReaderService;
    const jiraService = yield* ImportJiraService;

    yield* Console.error(`Validating artifact ${config.artifactPath}`);
    const records = yield* artifactReader.read(config.artifactPath).pipe(Stream.runCollect);
    yield* Console.error(
      `Verifying Jira global admin permission for import target ${config.target}`,
    );
    yield* jiraService.verifyGlobalAdmin;
    const plan = yield* assessImportPlan(config, records);
    const state = emptyState(plan);

    yield* Effect.forEach(plan.spaces, (space) => applySpace(space, jiraService, state), {
      discard: true,
    });

    yield* Console.error(
      "Imported Jira spaces must be reconnected to Intercom using https://toolspl.us/intercom-for-jira-cloud-setup-connection",
    );

    return summaryFromState(plan, state);
  });

export class ImportService extends Context.Service<
  ImportService,
  {
    readonly run: Effect.Effect<ImportSummary, AppError>;
  }
>()("ifj/import/ImportService") {
  static readonly layerNoDeps = (
    config: ImportConfig,
  ): Layer.Layer<ImportService, never, ArtifactReaderService | ImportJiraService> =>
    Layer.effect(
      ImportService,
      Effect.gen(function* () {
        const artifactReader = yield* ArtifactReaderService;
        const jiraService = yield* ImportJiraService;
        return ImportService.of({
          run: importProgram(config).pipe(
            Effect.provideService(ArtifactReaderService, artifactReader),
            Effect.provideService(ImportJiraService, jiraService),
          ),
        });
      }),
    );

  static readonly layer = (
    config: ImportConfig,
  ): Layer.Layer<ImportService, never, NodeServices.NodeServices> =>
    ImportService.layerNoDeps(config).pipe(
      Layer.provide(
        Layer.mergeAll(
          ArtifactReaderService.layer,
          ImportJiraService.layer.pipe(
            Layer.provide(
              JiraClient.layer({
                siteUrl: config.target,
                user: config.user,
                apiToken: config.apiToken,
              }),
            ),
          ),
        ),
      ),
    );
}
