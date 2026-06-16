import { Config, Schema, type Redacted } from "effect";

import {
  JiraCloudSource,
  normalizeSpaceList,
  RedactedNonEmptyString,
  TrimmedNonEmptyString,
} from "./config.model.js";

export interface ImportConfig {
  readonly target: string;
  readonly user: string;
  readonly apiToken: Redacted.Redacted;
  readonly artifactPath: string;
  readonly spaces: readonly string[];
  readonly json: boolean;
}

export const targetConfig: Config.Config<string> = Config.schema(JiraCloudSource, "IMPORT_TARGET");

export const importUserConfig: Config.Config<string> = Config.schema(
  TrimmedNonEmptyString,
  "IMPORT_USER",
);

export const importApiTokenConfig: Config.Config<Redacted.Redacted> = Config.schema(
  RedactedNonEmptyString,
  "IMPORT_API_TOKEN",
);

export const importArtifactPathConfig: Config.Config<string> = Config.schema(
  TrimmedNonEmptyString,
  "IMPORT_ARTIFACT_PATH",
);

export const importSpacesConfig: Config.Config<readonly string[]> = Config.schema(
  Config.Array(Schema.String),
  "IMPORT_SPACES",
).pipe(Config.map(normalizeSpaceList), Config.withDefault([]));
