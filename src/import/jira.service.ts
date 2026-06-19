import {
  Array as Arr,
  Context,
  Data,
  Effect,
  Layer,
  Option,
  Ref,
  Schedule,
  Schema,
  Stream,
} from "effect";

import { AppError } from "../errors.js";
import {
  conversationLinksPropertyKey,
  spaceConfigurationPropertyKey,
} from "../shared/app/index.js";
import type {
  JiraIssuePropertyUpdate,
  JiraJsonPropertyValue,
  JiraTaskResponse,
} from "../shared/jira/index.js";
import { JiraClient } from "../shared/jira/index.js";
import type { ResolvedWorkItem } from "./import.model.js";

const projectSearchKeyChunkSize = 50;

const terminalStatuses = new Set(["COMPLETE", "FAILED", "CANCELLED"]);
const TaskStatusInput = Schema.Struct({
  status: Schema.String,
});
const BulkIssuePropertyTaskResult = Schema.Struct({
  failedEntities: Schema.Record(Schema.String, Schema.Unknown),
  errors: Schema.Struct({
    errors: Schema.Record(Schema.String, Schema.Unknown),
    errorMessages: Schema.Array(Schema.String),
    reasons: Schema.Array(Schema.String),
  }),
});

type BulkIssuePropertyTaskResult = Schema.Schema.Type<typeof BulkIssuePropertyTaskResult>;
type BulkTaskResultCheck = Data.TaggedEnum<{
  Success: {
    readonly result: BulkIssuePropertyTaskResult;
  };
  Failed: {
    readonly message: string;
    readonly result: BulkIssuePropertyTaskResult;
  };
  Unknown: {
    readonly message: string;
    readonly result: unknown;
  };
}>;

const BulkTaskResultCheck = Data.taggedEnum<BulkTaskResultCheck>();

const checkBulkIssuePropertyTaskResult = (result: unknown): BulkTaskResultCheck => {
  const decoded = Schema.decodeUnknownOption(BulkIssuePropertyTaskResult)(result);
  if (Option.isNone(decoded)) {
    return BulkTaskResultCheck.Unknown({
      message: "Jira bulk issue property task returned an unrecognized result.",
      result,
    });
  }

  const taskResult = decoded.value;
  const hasFailures =
    Object.keys(taskResult.failedEntities).length > 0 ||
    Object.keys(taskResult.errors.errors).length > 0 ||
    taskResult.errors.errorMessages.length > 0 ||
    taskResult.errors.reasons.length > 0;

  return hasFailures
    ? BulkTaskResultCheck.Failed({
        message: "Jira bulk issue property task reported failed entities or errors.",
        result: taskResult,
      })
    : BulkTaskResultCheck.Success({ result: taskResult });
};

const verifyGlobalAdmin = (jiraClient: JiraClient["Service"]): Effect.Effect<void, AppError> =>
  Effect.gen(function* () {
    const permissions = yield* jiraClient.getMyPermissions(["ADMINISTER"]);
    if (!permissions["ADMINISTER"]?.havePermission) {
      return yield* new AppError(
        "jira.permission",
        "User does not have Jira global admin permission.",
        {
          context: { path: "/rest/api/3/mypermissions", permission: "ADMINISTER" },
        },
      );
    }
  });

const targetSpaceAvailable = (
  jiraClient: JiraClient["Service"],
  spaceKey: string,
): Effect.Effect<boolean, AppError> =>
  jiraClient.searchProjectSpaces({ keys: [spaceKey] }).pipe(
    Stream.runCollect,
    Effect.map((spaces) =>
      spaces.some((space) => space.key.toUpperCase() === spaceKey.toUpperCase()),
    ),
  );

const writeSpaceConfiguration = (
  jiraClient: JiraClient["Service"],
  spaceKey: string,
  configuration: JiraJsonPropertyValue,
): Effect.Effect<void, AppError> =>
  jiraClient.writeProjectProperty(spaceKey, spaceConfigurationPropertyKey, configuration);

const resolveWorkItems = (
  jiraClient: JiraClient["Service"],
  workItemKeys: readonly string[],
): Effect.Effect<readonly ResolvedWorkItem[], AppError> =>
  Effect.forEach(Arr.chunksOf(workItemKeys, projectSearchKeyChunkSize), (chunk) =>
    jiraClient.bulkFetchWorkItems(chunk).pipe(
      Effect.map((items) => {
        const byKey = new Map(items.map((item) => [item.key.toUpperCase(), item]));
        return Arr.getSomes(
          chunk.map((requestedKey) =>
            Option.fromNullishOr(byKey.get(requestedKey.toUpperCase())).pipe(
              Option.map((item) => ({
                requestedKey,
                id: item.id,
                key: item.key,
              })),
            ),
          ),
        );
      }),
    ),
  ).pipe(Effect.map(Arr.flatten));

const pollTaskUntilTerminal = (
  jiraClient: JiraClient["Service"],
  taskLocation: string,
): Effect.Effect<JiraTaskResponse, AppError> =>
  Effect.gen(function* () {
    const latest = yield* Ref.make<JiraTaskResponse | undefined>(undefined);
    yield* jiraClient.getTask(taskLocation).pipe(
      Effect.tap((task) => Ref.set(latest, task)),
      Effect.repeat(
        Schedule.spaced("2 seconds").pipe(
          Schedule.while(({ input }) => {
            const task = Schema.decodeUnknownOption(TaskStatusInput)(input);
            return Option.isSome(task) && !terminalStatuses.has(task.value.status);
          }),
        ),
      ),
    );
    const task = yield* Ref.get(latest);
    if (task === undefined) {
      return yield* new AppError("jira.malformed", "Jira task polling did not return a status.", {
        context: { taskLocation },
      });
    }
    return task;
  });

const writeWorkItemConversationLinks = (
  jiraClient: JiraClient["Service"],
  propertyUpdates: readonly JiraIssuePropertyUpdate[],
): Effect.Effect<void, AppError> =>
  Effect.gen(function* () {
    const taskLocation = yield* jiraClient.submitIssuePropertyBulkTask(
      conversationLinksPropertyKey,
      propertyUpdates,
    );
    const task = yield* pollTaskUntilTerminal(jiraClient, taskLocation);
    if (task.status !== "COMPLETE") {
      return yield* new AppError("import.bulkTaskFailed", "Jira bulk issue property task failed.", {
        context: { taskLocation, status: task.status, errorMessage: task.errorMessage },
      });
    }
    const resultCheck = checkBulkIssuePropertyTaskResult(task.result);
    yield* BulkTaskResultCheck.$match(resultCheck, {
      Success: () => Effect.void,
      Failed: (failure) =>
        Effect.fail(
          new AppError("import.bulkTaskFailed", failure.message, {
            context: {
              taskLocation,
              status: task.status,
              result: failure.result,
            },
          }),
        ),
      Unknown: (failure) =>
        Effect.fail(
          new AppError("import.bulkTaskFailed", failure.message, {
            context: {
              taskLocation,
              status: task.status,
              result: failure.result,
            },
          }),
        ),
    });
  });

export class ImportJiraService extends Context.Service<
  ImportJiraService,
  {
    readonly verifyGlobalAdmin: Effect.Effect<void, AppError>;
    readonly targetSpaceAvailable: (spaceKey: string) => Effect.Effect<boolean, AppError>;
    readonly writeSpaceConfiguration: (
      spaceKey: string,
      configuration: JiraJsonPropertyValue,
    ) => Effect.Effect<void, AppError>;
    readonly resolveWorkItems: (
      workItemKeys: readonly string[],
    ) => Effect.Effect<readonly ResolvedWorkItem[], AppError>;
    /**
     * The space key is retained as import context for callers that batch writes per space;
     * Jira's bulk issue-property API currently only needs issue IDs.
     */
    readonly writeWorkItemConversationLinks: (
      spaceKey: string,
      propertyUpdates: readonly JiraIssuePropertyUpdate[],
    ) => Effect.Effect<void, AppError>;
  }
>()("ifj/import/ImportJiraService") {
  static readonly layer: Layer.Layer<ImportJiraService, never, JiraClient> = Layer.effect(
    ImportJiraService,
    Effect.gen(function* () {
      const jiraClient = yield* JiraClient;
      return ImportJiraService.of({
        verifyGlobalAdmin: verifyGlobalAdmin(jiraClient),
        targetSpaceAvailable: (spaceKey) => targetSpaceAvailable(jiraClient, spaceKey),
        writeSpaceConfiguration: (spaceKey, configuration) =>
          writeSpaceConfiguration(jiraClient, spaceKey, configuration),
        resolveWorkItems: (workItemKeys) => resolveWorkItems(jiraClient, workItemKeys),
        writeWorkItemConversationLinks: (_spaceKey, propertyUpdates) =>
          writeWorkItemConversationLinks(jiraClient, propertyUpdates),
      });
    }),
  );
}
