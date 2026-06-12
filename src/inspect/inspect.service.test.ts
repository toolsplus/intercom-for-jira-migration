import { NodeServices } from "@effect/platform-node";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "@effect/vitest";

import {
  ArtifactReaderService,
  type ArtifactRecord,
  ArtifactWriterService,
} from "../shared/artifact/index.js";
import { InspectService } from "./index.js";

const tempPath = async (name: string) => join(await mkdtemp(join(tmpdir(), "ifj-")), name);
const artifactWriterLayer = ArtifactWriterService.layer.pipe(Layer.provide(NodeServices.layer));
const inspectLayer = InspectService.layer.pipe(Layer.provide(NodeServices.layer));
const writeArtifactFixture = (path: string, records: readonly ArtifactRecord[]) =>
  ArtifactWriterService.use((service) => service.write(path, Stream.fromIterable(records))).pipe(
    Effect.provide(artifactWriterLayer),
  );

describe("inspect service", () => {
  it.effect("inspects through an injected artifact reader", () =>
    Effect.gen(function* () {
      const readerLayer = Layer.succeed(
        ArtifactReaderService,
        ArtifactReaderService.of({
          read: () =>
            Stream.fromIterable([
              {
                type: "manifest",
                createdAt: "2026-06-05T00:00:00.000Z",
                source: "https://example.atlassian.net",
              },
              {
                type: "workItemConversationLinks",
                spaceKey: "ENG",
                workItemKey: "ENG-1",
                conversationIds: ["abc"],
              },
            ]),
        }),
      );

      const summary = yield* InspectService.use((service) => service.run("memory.jsonl.gz")).pipe(
        Effect.provide(InspectService.layerNoDeps.pipe(Layer.provide(readerLayer))),
      );

      expect(summary).toMatchObject({
        artifactPath: "memory.jsonl.gz",
        source: "https://example.atlassian.net",
        spacesProcessed: 1,
        workItemConversationLinkRecords: 1,
        conversationIds: 1,
      });
    }),
  );

  it.effect("inspects aggregate counts from an artifact", () =>
    Effect.gen(function* () {
      const path = yield* Effect.promise(() => tempPath("migration.jsonl.gz"));

      yield* writeArtifactFixture(path, [
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
      ]);

      const summary = yield* InspectService.use((service) => service.run(path)).pipe(
        Effect.provide(inspectLayer),
      );

      expect(summary).toEqual({
        artifactPath: path,
        source: "https://example.atlassian.net",
        createdAt: "2026-06-05T00:00:00.000Z",
        spacesProcessed: 1,
        spaceConfigurationRecords: 1,
        workItemConversationLinkRecords: 1,
        conversationIds: 2,
      });
    }),
  );
});
