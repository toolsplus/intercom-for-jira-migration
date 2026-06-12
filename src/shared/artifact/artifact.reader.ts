import { createGunzip } from "node:zlib";
import { NodeStream } from "@effect/platform-node";
import { Context, Effect, FileSystem, Layer, Ref, Schema, Stream } from "effect";

import { AppError } from "../../errors.js";
import { ArtifactRecord } from "./artifact.model.js";
import { assertArtifactPath } from "./artifact.path.js";

const decodeArtifactRecord = (
  record: unknown,
  recordNumber: number,
): Effect.Effect<ArtifactRecord, AppError> =>
  Schema.decodeUnknownEffect(ArtifactRecord)(record).pipe(
    Effect.mapError(
      (cause) =>
        new AppError(
          "artifact.invalidRecord",
          `Invalid artifact record at line ${String(recordNumber)}.`,
          {
            context: { recordNumber },
            cause,
          },
        ),
    ),
  );

const validateManifestPosition = (
  record: ArtifactRecord,
  recordNumber: number,
): Effect.Effect<ArtifactRecord, AppError> => {
  if (recordNumber === 1 && record.type !== "manifest") {
    return Effect.fail(
      new AppError("artifact.manifestMissing", "First artifact record must be a manifest.", {
        context: { recordNumber },
      }),
    );
  }
  if (recordNumber > 1 && record.type === "manifest") {
    return Effect.fail(
      new AppError(
        "artifact.manifestMisplaced",
        `Manifest record is only allowed at record 1, found at record ${String(recordNumber)}.`,
        { context: { recordNumber } },
      ),
    );
  }
  return Effect.succeed(record);
};

const parseArtifactLine = (
  line: string,
  recordNumber: number,
): Effect.Effect<ArtifactRecord, AppError> => {
  if (line.length === 0) {
    return Effect.fail(
      new AppError("artifact.blankLine", `Blank line at record ${String(recordNumber)}.`, {
        context: { recordNumber },
      }),
    );
  }

  return Effect.try({
    try: () => JSON.parse(line) as unknown,
    catch: (cause) =>
      new AppError("artifact.invalidJson", `Invalid JSON at record ${String(recordNumber)}.`, {
        context: { recordNumber },
        cause,
      }),
  }).pipe(
    Effect.flatMap((parsed) => decodeArtifactRecord(parsed, recordNumber)),
    Effect.flatMap((record) => validateManifestPosition(record, recordNumber)),
  );
};

const invalidGzipError = (cause: unknown): AppError =>
  new AppError("artifact.invalidGzip", "Artifact is not valid gzip JSON Lines.", { cause });

const artifactLineStream = (path: string): Stream.Stream<string, AppError, FileSystem.FileSystem> =>
  Stream.unwrap(
    Effect.gen(function* () {
      yield* assertArtifactPath(path);
      const fs = yield* FileSystem.FileSystem;

      return fs.stream(path).pipe(
        Stream.mapError((cause) => invalidGzipError(cause)),
        NodeStream.pipeThroughDuplex({
          evaluate: createGunzip,
          onError: invalidGzipError,
        }),
        Stream.decodeText,
        Stream.splitLines,
      );
    }),
  );

const readArtifactRecords = (
  path: string,
): Stream.Stream<ArtifactRecord, AppError, FileSystem.FileSystem> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const sawManifest = yield* Ref.make(false);
      let recordNumber = 0;
      const records = artifactLineStream(path).pipe(
        Stream.mapEffect((line) =>
          Effect.sync(() => {
            recordNumber += 1;
            return recordNumber;
          }).pipe(
            Effect.flatMap((recordNumber) =>
              parseArtifactLine(line, recordNumber).pipe(
                Effect.tap((record) =>
                  record.type === "manifest" ? Ref.set(sawManifest, true) : Effect.void,
                ),
              ),
            ),
          ),
        ),
      );
      const requireManifest = Stream.fromEffect(
        Ref.get(sawManifest).pipe(
          Effect.flatMap((saw) =>
            saw
              ? Effect.void
              : Effect.fail(
                  new AppError(
                    "artifact.manifestMissing",
                    "Artifact is empty or missing its manifest.",
                  ),
                ),
          ),
        ),
      ).pipe(Stream.drain);

      return records.pipe(Stream.concat(requireManifest));
    }),
  );

export class ArtifactReaderService extends Context.Service<
  ArtifactReaderService,
  {
    readonly read: (path: string) => Stream.Stream<ArtifactRecord, AppError>;
  }
>()("ifj/artifact/ArtifactReaderService") {
  static readonly layer: Layer.Layer<ArtifactReaderService, never, FileSystem.FileSystem> =
    Layer.effect(
      ArtifactReaderService,
      FileSystem.FileSystem.pipe(
        Effect.map((fs) =>
          ArtifactReaderService.of({
            read: (path) =>
              readArtifactRecords(path).pipe(Stream.provideService(FileSystem.FileSystem, fs)),
          }),
        ),
      ),
    );
}
