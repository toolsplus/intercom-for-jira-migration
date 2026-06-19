import { Schema } from "effect";

export const artifactExtension = ".jsonl.gz";

export const ManifestRecord = Schema.Struct({
  type: Schema.Literal("manifest"),
  createdAt: Schema.String,
  source: Schema.String,
});
export type ManifestRecord = Schema.Schema.Type<typeof ManifestRecord>;

export const SpaceConfigurationRecord = Schema.Struct({
  type: Schema.Literal("spaceConfiguration"),
  spaceKey: Schema.String,
  configuration: Schema.Json,
});
export type SpaceConfigurationRecord = Schema.Schema.Type<typeof SpaceConfigurationRecord>;

const ConversationId = Schema.String.check(
  Schema.makeFilter(
    (conversationId) =>
      (conversationId.length > 0 && conversationId.trim() === conversationId) ||
      "Conversation ID must be a trimmed non-empty string.",
  ),
);

export const WorkItemConversationLinksRecord = Schema.Struct({
  type: Schema.Literal("workItemConversationLinks"),
  spaceKey: Schema.String,
  workItemKey: Schema.String,
  conversationIds: Schema.Array(ConversationId),
}).check(
  Schema.makeFilter(
    (record) =>
      record.workItemKey.startsWith(`${record.spaceKey}-`) ||
      "Work item key must belong to the declared space.",
  ),
);
export type WorkItemConversationLinksRecord = Schema.Schema.Type<
  typeof WorkItemConversationLinksRecord
>;

export const ArtifactRecord = Schema.Union([
  ManifestRecord,
  SpaceConfigurationRecord,
  WorkItemConversationLinksRecord,
]);
export type ArtifactRecord = Schema.Schema.Type<typeof ArtifactRecord>;

export interface ArtifactCounts {
  readonly spacesProcessed: number;
  readonly spaceConfigurationRecords: number;
  readonly workItemConversationLinkRecords: number;
  readonly conversationIds: number;
}
