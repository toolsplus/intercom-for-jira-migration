import { Array as Arr, Context, Effect, Layer, Option, Order, Stream } from "effect";
import { AppError } from "../errors.js";
import {
  conversationLinksPropertyKey,
  spaceConfigurationPropertyKey,
} from "../shared/app/index.js";
import { JiraClient, type JiraProjectSpace, type JiraWorkItem } from "../shared/jira/index.js";

const intercomIntegrationStatusPropertyQuery = "[intercomIntegrationStatus]=true";
const projectSearchKeyChunkSize = 50;

export interface ExportJiraSpace {
  readonly key: string;
  readonly configuration?: Option.Option<unknown>;
}

export interface JiraWorkItemLinkHit {
  readonly key: string;
  readonly propertyValue: unknown;
}

export class JiraService extends Context.Service<
  JiraService,
  {
    readonly verifyGlobalAdmin: Effect.Effect<void, AppError>;
    readonly discoverConfiguredSpaces: Effect.Effect<readonly ExportJiraSpace[], AppError>;
    readonly validateSpaces: (
      spaceKeys: readonly string[],
    ) => Effect.Effect<readonly ExportJiraSpace[], AppError>;
    readonly approximateLinkedWorkItemCount: (
      spaceKeys: readonly string[],
    ) => Effect.Effect<number, AppError>;
    readonly searchWorkItemConversationLinks: (
      spaceKey: string,
    ) => Stream.Stream<JiraWorkItemLinkHit, AppError>;
  }
>()("ifj/export/JiraService") {
  static readonly layer: Layer.Layer<JiraService, never, JiraClient> = Layer.effect(
    JiraService,
    makeJiraService(),
  );
}

const quoteJqlString = (value: string): string =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

const scopeJql = (spaceKeys: readonly string[]): string =>
  spaceKeys.length === 0
    ? "linkedIntercomConversationCount > 0"
    : `project in (${spaceKeys.map(quoteJqlString).join(", ")}) AND linkedIntercomConversationCount > 0`;

const sortSpaces = <A extends { readonly key: string }>(spaces: readonly A[]): readonly A[] =>
  Arr.sortWith(spaces, (space) => space.key, Order.String);

const exportSpace = (project: JiraProjectSpace): ExportJiraSpace => ({
  key: project.key,
  configuration: Option.fromNullishOr(project.properties[spaceConfigurationPropertyKey]),
});

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

const discoverConfiguredSpaces = (
  jiraClient: JiraClient["Service"],
): Effect.Effect<readonly ExportJiraSpace[], AppError> =>
  jiraClient
    .searchProjectSpaces({
      propertyQuery: intercomIntegrationStatusPropertyQuery,
      properties: [spaceConfigurationPropertyKey],
    })
    .pipe(Stream.map(exportSpace), Stream.runCollect, Effect.map(sortSpaces));

const validateSpaces = (
  jiraClient: JiraClient["Service"],
  spaceKeys: readonly string[],
): Effect.Effect<readonly ExportJiraSpace[], AppError> =>
  Effect.gen(function* () {
    const found = yield* Effect.forEach(
      Arr.chunksOf(spaceKeys, projectSearchKeyChunkSize),
      (chunk) =>
        jiraClient
          .searchProjectSpaces({
            keys: chunk,
            properties: [spaceConfigurationPropertyKey],
          })
          .pipe(Stream.map(exportSpace), Stream.runCollect),
    ).pipe(Effect.map(Arr.flatten));

    const foundKeys = new Set(found.map((space) => space.key.toLowerCase()));
    const missingSpaceKeys = spaceKeys.filter((key) => !foundKeys.has(key.toLowerCase()));
    if (missingSpaceKeys.length > 0) {
      return yield* new AppError("jira.request", "Jira did not return all selected spaces.", {
        context: {
          path: "/rest/api/3/project/search",
          missingSpaceKeys,
        },
      });
    }
    return sortSpaces(found);
  });

const approximateLinkedWorkItemCount = (
  jiraClient: JiraClient["Service"],
  spaceKeys: readonly string[],
): Effect.Effect<number, AppError> => jiraClient.approximateSearchCount(scopeJql(spaceKeys));

const linkedWorkItemsJql = (spaceKey: string): string => `${scopeJql([spaceKey])} ORDER BY key ASC`;

const linkHit = (issue: JiraWorkItem): JiraWorkItemLinkHit => ({
  key: issue.key,
  propertyValue: issue.properties[conversationLinksPropertyKey],
});

const searchWorkItemConversationLinks = (
  jiraClient: JiraClient["Service"],
  spaceKey: string,
): Stream.Stream<JiraWorkItemLinkHit, AppError> =>
  jiraClient
    .searchWorkItems({
      jql: linkedWorkItemsJql(spaceKey),
      fields: ["key"],
      properties: [conversationLinksPropertyKey],
    })
    .pipe(Stream.map(linkHit));

function makeJiraService(): Effect.Effect<JiraService["Service"], never, JiraClient> {
  return Effect.gen(function* () {
    const jiraClient = yield* JiraClient;

    return JiraService.of({
      verifyGlobalAdmin: verifyGlobalAdmin(jiraClient),
      discoverConfiguredSpaces: discoverConfiguredSpaces(jiraClient),
      validateSpaces: (spaceKeys) => validateSpaces(jiraClient, spaceKeys),
      approximateLinkedWorkItemCount: (spaceKeys) =>
        approximateLinkedWorkItemCount(jiraClient, spaceKeys),
      searchWorkItemConversationLinks: (spaceKey) =>
        searchWorkItemConversationLinks(jiraClient, spaceKey),
    });
  });
}
