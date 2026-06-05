import { createGzip } from "node:zlib";
import { NodeStream } from "@effect/platform-node";
import { Context, Crypto, Effect, FileSystem, Layer, Path, Schema, Stream } from "effect";

import { AppError } from "../../errors.js";
import { ArtifactRecord } from "./artifact.model.js";
import {
  ensureOutputTarget,
  moveTempArtifact,
  removeArtifactFile,
  removeTempArtifact,
} from "./artifact.path.js";

const encodeArtifactRecord = (record: ArtifactRecord): Effect.Effect<unknown, AppError> =>
  Schema.encodeUnknownEffect(ArtifactRecord)(record).pipe(
    Effect.mapError(
      (cause) =>
        new AppError("artifact.invalidRecord", "Artifact writer received an invalid record.", {
          cause,
        }),
    ),
  );

const invalidArtifactWriteError = (cause: unknown): AppError =>
  cause instanceof AppError
    ? cause
    : new AppError("artifact.invalidRecord", "Failed to write artifact record.", { cause });

const tempSiblingPath = (
  outputPath: string,
): Effect.Effect<string, AppError, Crypto.Crypto | Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const crypto = yield* Crypto.Crypto;
    const nonce = yield* crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new AppError("export.invalidOutput", "Failed to create a temporary artifact path.", {
            context: { outputPath },
            cause,
          }),
      ),
    );
    return path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.${nonce}.tmp`);
  });

const recordsToCompressedBytes = <R>(
  records: Stream.Stream<ArtifactRecord, AppError, R>,
): Stream.Stream<Uint8Array, AppError, R> =>
  records.pipe(
    Stream.mapEffect(encodeArtifactRecord),
    Stream.map((record) => `${JSON.stringify(record)}\n`),
    Stream.encodeText,
    NodeStream.pipeThroughDuplex({
      evaluate: createGzip,
      onError: invalidArtifactWriteError,
    }),
  );

const writeCompressedArtifact = <R>(
  path: string,
  records: Stream.Stream<ArtifactRecord, AppError, R>,
): Effect.Effect<void, AppError, FileSystem.FileSystem | R> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* recordsToCompressedBytes(records).pipe(
      Stream.run(fs.sink(path, { flag: "wx" })),
      Effect.mapError(invalidArtifactWriteError),
    );
  }).pipe(
    Effect.catch((error) => removeArtifactFile(path).pipe(Effect.andThen(Effect.fail(error)))),
  );

const writeArtifactRecords = <R>(
  requestedPath: string,
  records: Stream.Stream<ArtifactRecord, AppError, R>,
): Effect.Effect<string, AppError, Crypto.Crypto | FileSystem.FileSystem | Path.Path | R> =>
  Effect.gen(function* () {
    const outputPath = yield* ensureOutputTarget(requestedPath);
    const tempPath = yield* tempSiblingPath(outputPath);

    return yield* writeCompressedArtifact(tempPath, records).pipe(
      Effect.andThen(moveTempArtifact(tempPath, outputPath)),
      Effect.as(outputPath),
      Effect.catch((error) =>
        removeTempArtifact(tempPath).pipe(Effect.andThen(Effect.fail(error))),
      ),
    );
  });

export class ArtifactWriterService extends Context.Service<
  ArtifactWriterService,
  {
    readonly write: <R>(
      requestedPath: string,
      records: Stream.Stream<ArtifactRecord, AppError, R>,
    ) => Effect.Effect<string, AppError, R>;
  }
>()("ifj/artifact/ArtifactWriterService") {
  static readonly layer: Layer.Layer<
    ArtifactWriterService,
    never,
    Crypto.Crypto | FileSystem.FileSystem | Path.Path
  > = Layer.effect(
    ArtifactWriterService,
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      return ArtifactWriterService.of({
        write: (requestedPath, records) =>
          writeArtifactRecords(requestedPath, records).pipe(
            Effect.provideService(Crypto.Crypto, crypto),
            Effect.provideService(FileSystem.FileSystem, fileSystem),
            Effect.provideService(Path.Path, path),
          ),
      });
    }),
  );
}
