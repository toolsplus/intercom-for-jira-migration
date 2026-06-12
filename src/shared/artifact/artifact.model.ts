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

export const WorkItemConversationLinksRecord = Schema.Struct({
  type: Schema.Literal("workItemConversationLinks"),
  spaceKey: Schema.String,
  workItemKey: Schema.String,
  conversationIds: Schema.Array(Schema.String),
});

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
