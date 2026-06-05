import type { ExportSummary } from "./export.model.js";

export const formatExportSummary = (summary: ExportSummary): string => {
  const lines = ["Export complete", `Output: ${summary.outputPath}`, `Source: ${summary.source}`];
  if (summary.approximateLinkedWorkItemCount !== undefined) {
    lines.push(`Approximate linked work items: ${String(summary.approximateLinkedWorkItemCount)}`);
  }
  lines.push(
    `Spaces processed: ${String(summary.spacesProcessed)}`,
    `Space configuration records: ${String(summary.spaceConfigurationRecords)}`,
    `Work-item conversation-link records: ${String(summary.workItemConversationLinkRecords)}`,
    `Conversation IDs exported: ${String(summary.conversationIds)}`,
    `Warnings: ${String(summary.warningCount)}${summary.warningTruncated ? " (truncated)" : ""}`,
  );
  return lines.join("\n");
};
