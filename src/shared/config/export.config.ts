import { Config, Schema, type Redacted } from "effect";

import {
  JiraCloudSource,
  normalizeSpaceList,
  RedactedNonEmptyString,
  TrimmedNonEmptyString,
} from "./config.model.js";

const defaultExportFileName = "intercom-for-jira-export.jsonl.gz";

export interface ExportConfig {
  readonly source: string;
  readonly user: string;
  readonly apiToken: Redacted.Redacted;
  readonly out: string;
  readonly spaces: readonly string[];
  readonly json: boolean;
}

export const sourceConfig: Config.Config<string> = Config.schema(JiraCloudSource, "EXPORT_SOURCE");

export const userConfig: Config.Config<string> = Config.schema(
  TrimmedNonEmptyString,
  "EXPORT_USER",
);

export const apiTokenConfig: Config.Config<Redacted.Redacted> = Config.schema(
  RedactedNonEmptyString,
  "EXPORT_API_TOKEN",
);

export const outConfig: Config.Config<string> = Config.schema(
  TrimmedNonEmptyString,
  "EXPORT_OUT",
).pipe(Config.withDefault(defaultExportFileName));

export const spacesConfig: Config.Config<readonly string[]> = Config.schema(
  Config.Array(Schema.String),
  "EXPORT_SPACES",
).pipe(Config.map(normalizeSpaceList), Config.withDefault([]));
