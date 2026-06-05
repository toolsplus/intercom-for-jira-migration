import { Config } from "effect";

import { TrimmedNonEmptyString } from "./config.model.js";

export const inspectArtifactPathConfig: Config.Config<string> = Config.schema(
  TrimmedNonEmptyString,
  "INSPECT_ARTIFACT_PATH",
);
