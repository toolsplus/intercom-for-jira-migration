import type { Schema } from "effect";

import type { ArtifactCounts } from "../shared/artifact/index.js";

export interface ExportSummary extends ArtifactCounts {
  readonly outputPath: string;
  readonly source: string;
  readonly approximateLinkedWorkItemCount?: number;
  readonly warningCount: number;
  readonly warningTruncated: boolean;
}

export interface MutableCounts {
  spacesProcessed: number;
  spaceConfigurationRecords: number;
  workItemConversationLinkRecords: number;
  conversationIds: number;
}

export interface LinkPropertyDecodeFailure {
  readonly currentSchemaError: Schema.SchemaError;
  readonly legacySchemaError: Schema.SchemaError;
}
