import type { InspectSummary } from "./inspect.model.js";

export const formatInspectSummary = (summary: InspectSummary): string =>
  [
    "Artifact valid",
    `Path: ${summary.artifactPath}`,
    `Source: ${summary.source}`,
    `Created at: ${summary.createdAt}`,
    `Spaces processed: ${String(summary.spacesProcessed)}`,
    `Space configuration records: ${String(summary.spaceConfigurationRecords)}`,
    `Work-item conversation-link records: ${String(summary.workItemConversationLinkRecords)}`,
    `Conversation IDs: ${String(summary.conversationIds)}`,
  ].join("\n");
