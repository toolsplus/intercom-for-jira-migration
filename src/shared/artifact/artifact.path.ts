import { Effect, FileSystem, Option, Path } from "effect";

import { AppError } from "../../errors.js";
import { artifactExtension } from "./artifact.model.js";

export const assertArtifactPath = (path: string): Effect.Effect<void, AppError> =>
  path.endsWith(artifactExtension)
    ? Effect.void
    : Effect.fail(
        new AppError(
          "artifact.invalidExtension",
          `Artifact path must end with ${artifactExtension}.`,
          { context: { path } },
        ),
      );

export const removeArtifactFile = (
  path: string,
): Effect.Effect<void, never, FileSystem.FileSystem> =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.remove(path, { force: true })),
    Effect.ignore,
  );

const statRequiredDirectory = (
  path: string,
  outputPath: string,
): Effect.Effect<FileSystem.File.Info, AppError, FileSystem.FileSystem> =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.stat(path)),
    Effect.mapError(
      (cause) =>
        new AppError("export.outputParentMissing", "Output parent directory does not exist.", {
          context: { outputPath, parent: path },
          cause,
        }),
    ),
  );

const statOptional = (
  path: string,
): Effect.Effect<Option.Option<FileSystem.File.Info>, AppError, FileSystem.FileSystem> =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) =>
      fs
        .exists(path)
        .pipe(
          Effect.flatMap((exists) =>
            exists ? fs.stat(path).pipe(Effect.map(Option.some)) : Effect.succeed(Option.none()),
          ),
        ),
    ),
    Effect.mapError(
      (cause) =>
        new AppError("export.invalidOutput", "Failed to inspect output path.", {
          context: { outputPath: path },
          cause,
        }),
    ),
  );

export const ensureOutputTarget = (
  outputPath: string,
): Effect.Effect<string, AppError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    yield* assertArtifactPath(outputPath);
    const path = yield* Path.Path;
    const parent = path.dirname(outputPath);
    const parentStat = yield* statRequiredDirectory(parent, outputPath);
    if (parentStat.type !== "Directory") {
      return yield* new AppError(
        "export.outputParentMissing",
        "Output parent path is not a directory.",
        {
          context: { outputPath, parent },
        },
      );
    }

    const existing = yield* statOptional(outputPath);
    if (Option.isNone(existing)) {
      return outputPath;
    }
    if (existing.value.type === "Directory") {
      return yield* new AppError("export.invalidOutput", "Output path points to a directory.", {
        context: { outputPath },
      });
    }

    const stem = path.basename(outputPath).slice(0, -artifactExtension.length);
    const findAvailableNumberedOutputPath = (
      suffix: number,
    ): Effect.Effect<string, AppError, FileSystem.FileSystem> =>
      Effect.gen(function* () {
        const candidate = path.join(parent, `${stem}${String(suffix)}${artifactExtension}`);
        const candidateExisting = yield* statOptional(candidate);
        if (Option.isNone(candidateExisting)) {
          return candidate;
        }
        return yield* findAvailableNumberedOutputPath(suffix + 1);
      });

    return yield* findAvailableNumberedOutputPath(1);
  });

export const moveTempArtifact = (
  tempPath: string,
  outputPath: string,
): Effect.Effect<void, AppError, FileSystem.FileSystem> =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fs) => fs.rename(tempPath, outputPath)),
    Effect.mapError(
      (cause) =>
        new AppError("export.invalidOutput", "Failed to move completed artifact into place.", {
          context: { tempPath, outputPath },
          cause,
        }),
    ),
  );

export const removeTempArtifact = (
  tempPath: string,
): Effect.Effect<void, never, FileSystem.FileSystem> => removeArtifactFile(tempPath);
