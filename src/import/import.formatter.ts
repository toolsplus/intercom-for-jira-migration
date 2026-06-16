import type { ImportSummary } from "./import.model.js";

export const formatImportSummary = (summary: ImportSummary): string =>
  [
    "Import complete",
    `Source: ${summary.source}`,
    `Target: ${summary.target}`,
    `Selected spaces: ${summary.selectedSpaces.length === 0 ? "(none)" : summary.selectedSpaces.join(", ")}`,
    `Spaces imported: ${String(summary.spacesImported)}`,
    `Space configurations written: ${String(summary.spaceConfigurationsWritten)}`,
    `Work-item conversation-link records imported: ${String(summary.workItemLinkRecordsImported)}`,
    `Conversation IDs imported: ${String(summary.conversationIdsImported)}`,
    `Warnings: ${String(summary.warningCount)}`,
    `Skipped spaces: ${String(summary.skippedSpaceCount)}`,
    `Failed space configurations: ${String(summary.failedSpaceConfigurationCount)}`,
    `Skipped work-item links: ${String(summary.skippedWorkItemLinkCount)}`,
    `Failed work-item link batches: ${String(summary.failedWorkItemLinkBatchCount)}`,
    summary.detailsTruncated ? "Details: truncated" : "Details: complete",
  ].join("\n");
