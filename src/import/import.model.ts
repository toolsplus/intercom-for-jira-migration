import type {
  ManifestRecord,
  SpaceConfigurationRecord,
  WorkItemConversationLinksRecord,
} from "../shared/artifact/index.js";

export interface ImportWarning {
  readonly code: "SAME_SITE_IMPORT";
  readonly message: string;
  readonly source: string;
  readonly target: string;
}

export interface SkippedSpace {
  readonly spaceKey: string;
  readonly reason: "absent-from-artifact" | "target-space-unavailable";
  readonly message: string;
}

export interface FailedSpaceConfiguration {
  readonly spaceKey: string;
  readonly reason: string;
}

export interface SkippedWorkItemLink {
  readonly spaceKey: string;
  readonly workItemKey: string;
  readonly reason: "missing-target-work-item" | "target-key-mismatch";
  readonly message: string;
}

export interface FailedWorkItemLinkBatch {
  readonly spaceKey: string;
  readonly batchNumber: number;
  readonly reason: string;
}

export interface ImportSpacePlan {
  readonly spaceKey: string;
  readonly configurationRecords: readonly SpaceConfigurationRecord[];
  readonly workItemLinkRecords: readonly WorkItemConversationLinksRecord[];
}

export interface ImportPlan {
  readonly manifest: ManifestRecord;
  readonly source: string;
  readonly target: string;
  readonly selectedSpaceKeys: readonly string[];
  readonly spaces: readonly ImportSpacePlan[];
  readonly warnings: readonly ImportWarning[];
  readonly skippedSpaces: readonly SkippedSpace[];
}

export interface ImportSummary {
  readonly source: string;
  readonly target: string;
  readonly selectedSpaces: readonly string[];
  readonly spacesImported: number;
  readonly spaceConfigurationsWritten: number;
  readonly workItemLinkRecordsImported: number;
  readonly conversationIdsImported: number;
  readonly warningCount: number;
  readonly skippedSpaceCount: number;
  readonly failedSpaceConfigurationCount: number;
  readonly skippedWorkItemLinkCount: number;
  readonly failedWorkItemLinkBatchCount: number;
  readonly warnings: readonly ImportWarning[];
  readonly skippedSpaces: readonly SkippedSpace[];
  readonly failedSpaceConfigurations: readonly FailedSpaceConfiguration[];
  readonly skippedWorkItemLinks: readonly SkippedWorkItemLink[];
  readonly failedWorkItemLinkBatches: readonly FailedWorkItemLinkBatch[];
  readonly detailsTruncated: boolean;
}

export interface ResolvedWorkItem {
  readonly requestedKey: string;
  readonly id: string;
  readonly key: string;
}
