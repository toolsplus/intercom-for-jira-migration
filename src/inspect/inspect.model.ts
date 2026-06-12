import type { ArtifactCounts, ManifestRecord } from "../shared/artifact/index.js";

export interface InspectSummary extends ArtifactCounts {
  readonly source: string;
  readonly createdAt: string;
  readonly artifactPath: string;
}

export interface InspectState {
  readonly manifest: ManifestRecord | undefined;
  readonly spaceKeys: Set<string>;
  readonly spaceConfigurationRecords: number;
  readonly workItemConversationLinkRecords: number;
  readonly conversationIds: number;
}
