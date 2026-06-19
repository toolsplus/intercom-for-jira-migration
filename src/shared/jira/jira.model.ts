import { Effect, Schema, SchemaGetter } from "effect";

export const JiraProperties = Schema.Record(Schema.String, Schema.Unknown);

export const JiraCredentials = Schema.Struct({
  siteUrl: Schema.String,
  user: Schema.String,
  apiToken: Schema.Redacted(Schema.String),
});
export type JiraCredentials = Schema.Schema.Type<typeof JiraCredentials>;

export const ApproximateSearchCountRequest = Schema.Struct({
  jql: Schema.String,
});

export const JiraSearchProjectSpacesParams = Schema.Struct({
  keys: Schema.optionalKey(Schema.Array(Schema.String)),
  propertyQuery: Schema.optionalKey(Schema.String),
  properties: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type JiraSearchProjectSpacesParams = Schema.Schema.Type<
  typeof JiraSearchProjectSpacesParams
>;

export const SearchWorkItemsRequest = Schema.Struct({
  jql: Schema.String,
  maxResults: Schema.Number,
  fields: Schema.optionalKey(Schema.Array(Schema.String)),
  properties: Schema.optionalKey(Schema.Array(Schema.String)),
  nextPageToken: Schema.optionalKey(Schema.String),
});
export type JiraSearchWorkItemsParams = Omit<
  Schema.Schema.Type<typeof SearchWorkItemsRequest>,
  "maxResults" | "nextPageToken"
>;

export const JiraJsonPropertyValue = Schema.Json;
export type JiraJsonPropertyValue = Schema.Schema.Type<typeof JiraJsonPropertyValue>;

export interface JiraIssuePropertyUpdate {
  readonly issueId: string;
  readonly value: JiraJsonPropertyValue;
}

export const ProjectPropertyRequest = JiraJsonPropertyValue;

export const BulkFetchWorkItemsRequest = Schema.Struct({
  issueIdsOrKeys: Schema.Array(Schema.String),
  fields: Schema.Array(Schema.String),
});

export const BulkFetchWorkItemsResponse = Schema.Struct({
  issues: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      key: Schema.String,
    }),
  ),
});
export type JiraBulkFetchedWorkItem = Schema.Schema.Type<
  typeof BulkFetchWorkItemsResponse
>["issues"][number];

export const BulkIssuePropertiesRequest = Schema.Struct({
  issues: Schema.Array(
    Schema.Struct({
      issueID: Schema.Number,
      properties: Schema.Record(Schema.String, JiraJsonPropertyValue),
    }),
  ),
});

export const JiraTaskStatus = Schema.Union([
  Schema.Literal("ENQUEUED"),
  Schema.Literal("RUNNING"),
  Schema.Literal("COMPLETE"),
  Schema.Literal("FAILED"),
  Schema.Literal("CANCELLED"),
]);
export const JiraTaskResponse = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  status: JiraTaskStatus,
  description: Schema.optionalKey(Schema.String),
  errorMessage: Schema.optionalKey(Schema.String),
  result: Schema.optionalKey(Schema.Unknown),
});
export type JiraTaskResponse = Schema.Schema.Type<typeof JiraTaskResponse>;

const JiraPropertiesField = Schema.optionalKey(JiraProperties).pipe(
  Schema.decodeTo(JiraProperties, {
    decode: SchemaGetter.withDefault(Effect.succeed({})),
    encode: SchemaGetter.passthrough(),
  }),
);

export const PermissionResponse = Schema.Struct({
  permissions: Schema.Record(
    Schema.String,
    Schema.Struct({
      havePermission: Schema.Boolean,
    }),
  ),
});
export type JiraPermissions = Schema.Schema.Type<typeof PermissionResponse>["permissions"];

export const ProjectSearch = Schema.Struct({
  values: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      properties: JiraPropertiesField,
    }),
  ),
});
export type JiraProjectSpace = Schema.Schema.Type<typeof ProjectSearch>["values"][number];

export const SearchResponse = Schema.Struct({
  issues: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      properties: JiraPropertiesField,
    }),
  ),
  isLast: Schema.optionalKey(Schema.Boolean),
  nextPageToken: Schema.optionalKey(Schema.String),
  total: Schema.optionalKey(Schema.Number),
});
export type JiraWorkItem = Schema.Schema.Type<typeof SearchResponse>["issues"][number];

export const CountResponse = Schema.Struct({
  count: Schema.Number,
});
