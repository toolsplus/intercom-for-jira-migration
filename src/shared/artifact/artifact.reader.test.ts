import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "@effect/vitest";

import { ArtifactReaderService } from "./index.js";

const tempPath = async (name: string) => join(await mkdtemp(join(tmpdir(), "ifj-")), name);
const artifactReaderLayer = ArtifactReaderService.layer.pipe(Layer.provide(NodeServices.layer));

describe("artifact reader", () => {
  it.effect("rejects blank JSONL lines with a record number", () =>
    Effect.gen(function* () {
      const path = yield* Effect.promise(() => tempPath("blank.jsonl.gz"));
      yield* Effect.promise(() =>
        writeFile(
          path,
          gzipSync(
            [
              JSON.stringify({
                type: "manifest",
                createdAt: "2026-06-05T00:00:00.000Z",
                source: "https://example.atlassian.net",
              }),
              "",
              JSON.stringify({
                type: "spaceConfiguration",
                spaceKey: "ENG",
                configuration: {},
              }),
            ].join("\n"),
          ),
        ),
      );

      const error = yield* ArtifactReaderService.use((service) =>
        service.read(path).pipe(Stream.runDrain),
      ).pipe(Effect.flip, Effect.provide(artifactReaderLayer));
      expect(error).toMatchObject({
        code: "artifact.blankLine",
        context: { recordNumber: 2 },
      });
    }),
  );
});
