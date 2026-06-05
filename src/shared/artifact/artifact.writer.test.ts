import { NodeServices } from "@effect/platform-node";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "@effect/vitest";

import { ArtifactReaderService, ArtifactWriterService } from "./index.js";

const tempPath = async (name: string) => join(await mkdtemp(join(tmpdir(), "ifj-")), name);
const artifactReaderLayer = ArtifactReaderService.layer.pipe(Layer.provide(NodeServices.layer));
const artifactWriterLayer = ArtifactWriterService.layer.pipe(Layer.provide(NodeServices.layer));

describe("artifact writer", () => {
  it.effect("writes compressed JSONL records", () =>
    Effect.gen(function* () {
      const path = yield* Effect.promise(() => tempPath("migration.jsonl.gz"));

      yield* ArtifactWriterService.use((service) =>
        service.write(
          path,
          Stream.fromIterable([
            {
              type: "manifest",
              createdAt: "2026-06-05T00:00:00.000Z",
              source: "https://example.atlassian.net",
            },
            {
              type: "spaceConfiguration",
              spaceKey: "ENG",
              configuration: { enabled: true },
            },
            {
              type: "workItemConversationLinks",
              spaceKey: "ENG",
              workItemKey: "ENG-1",
              conversationIds: ["abc", "def"],
            },
          ]),
        ),
      ).pipe(Effect.provide(artifactWriterLayer));

      const records = yield* ArtifactReaderService.use((service) =>
        service.read(path).pipe(Stream.runCollect),
      ).pipe(Effect.provide(artifactReaderLayer));
      expect(records).toHaveLength(3);
      expect(records[0]).toMatchObject({
        type: "manifest",
        source: "https://example.atlassian.net",
      });

      const raw = yield* Effect.promise(() => readFile(path));
      expect(raw[0]).not.toBe("{".charCodeAt(0));
    }),
  );
});
