import { Array as Arr, Effect, Order } from "effect";

import { AppError } from "../errors.js";
import type {
  ArtifactRecord,
  SpaceConfigurationRecord,
  WorkItemConversationLinksRecord,
} from "../shared/artifact/index.js";
import { normalizeSpaceList } from "../shared/config/index.js";
import type { ImportConfig } from "../shared/config/index.js";
import type { ImportPlan, ImportSpacePlan, ImportWarning, SkippedSpace } from "./import.model.js";

const sortStrings = (values: readonly string[]): readonly string[] =>
  Arr.sort(values, Order.String);

const artifactSpaceKeys = (records: readonly ArtifactRecord[]): readonly string[] =>
  sortStrings([
    ...new Set(
      records.flatMap((record) =>
        record.type === "spaceConfiguration" || record.type === "workItemConversationLinks"
          ? [record.spaceKey]
          : [],
      ),
    ),
  ]);

const normalizeSiteUrl = (value: string): string => {
  try {
    return new URL(value).origin;
  } catch {
    return value.toLowerCase().replace(/\/+$/, "");
  }
};

const sameSiteWarning = (source: string, target: string): readonly ImportWarning[] =>
  normalizeSiteUrl(source) === normalizeSiteUrl(target)
    ? [
        {
          code: "SAME_SITE_IMPORT",
          message: "Artifact source matches import target; continuing with same-site import.",
          source,
          target,
        },
      ]
    : [];

const absentSpace = (spaceKey: string): SkippedSpace => ({
  spaceKey,
  reason: "absent-from-artifact",
  message: `Selected space ${spaceKey} is not present in the artifact.`,
});

const buildSpacePlan = (spaceKey: string, records: readonly ArtifactRecord[]): ImportSpacePlan => ({
  spaceKey,
  configurationRecords: records.filter(
    (record): record is SpaceConfigurationRecord =>
      record.type === "spaceConfiguration" && record.spaceKey === spaceKey,
  ),
  workItemLinkRecords: records.filter(
    (record): record is WorkItemConversationLinksRecord =>
      record.type === "workItemConversationLinks" && record.spaceKey === spaceKey,
  ),
});

export const assessImportPlan = (
  config: ImportConfig,
  records: readonly ArtifactRecord[],
): Effect.Effect<ImportPlan, AppError> =>
  Effect.gen(function* () {
    const manifest = records[0];
    if (manifest?.type !== "manifest") {
      return yield* new AppError("artifact.manifestMissing", "Artifact is missing its manifest.");
    }

    const availableSpaceKeys = artifactSpaceKeys(records);
    const availableSpaceKeySet = new Set(availableSpaceKeys);
    const selectedSpaceKeys =
      config.spaces.length === 0 ? availableSpaceKeys : normalizeSpaceList(config.spaces);
    const skippedSpaces = selectedSpaceKeys
      .filter((spaceKey) => !availableSpaceKeySet.has(spaceKey))
      .map(absentSpace);
    const importableSpaceKeys = selectedSpaceKeys.filter((spaceKey) =>
      availableSpaceKeySet.has(spaceKey),
    );

    return {
      manifest,
      source: manifest.source,
      target: config.target,
      selectedSpaceKeys,
      spaces: importableSpaceKeys.map((spaceKey) => buildSpacePlan(spaceKey, records)),
      warnings: sameSiteWarning(manifest.source, config.target),
      skippedSpaces,
    };
  });
