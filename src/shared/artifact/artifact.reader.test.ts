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
const manifest = {
  type: "manifest",
  createdAt: "2026-06-05T00:00:00.000Z",
  source: "https://example.atlassian.net",
};

const writeRawArtifact = (path: string, lines: readonly unknown[]) =>
  Effect.promise(() =>
    writeFile(
      path,
      gzipSync(
        lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n"),
      ),
    ),
  );

const readFixture = (path: string) =>
  ArtifactReaderService.use((service) => service.read(path).pipe(Stream.runCollect)).pipe(
    Effect.provide(artifactReaderLayer),
  );

describe("artifact reader", () => {
  it.effect("rejects blank JSONL lines with a record number", () =>
    Effect.gen(function* () {
      const path = yield* Effect.promise(() => tempPath("blank.jsonl.gz"));
      yield* writeRawArtifact(path, [
        manifest,
        "",
        {
          type: "spaceConfiguration",
          spaceKey: "ENG",
          configuration: {},
        },
      ]);

      const error = yield* readFixture(path).pipe(Effect.flip);
      expect(error).toMatchObject({
        code: "artifact.blankLine",
        context: { recordNumber: 2 },
      });
    }),
  );

  it.effect("rejects work item link records whose key is outside the declared space", () =>
    Effect.gen(function* () {
      const path = yield* Effect.promise(() => tempPath("space-mismatch.jsonl.gz"));
      yield* writeRawArtifact(path, [
        manifest,
        {
          type: "workItemConversationLinks",
          spaceKey: "OPS",
          workItemKey: "ENG-1",
          conversationIds: ["abc"],
        },
      ]);

      const error = yield* readFixture(path).pipe(Effect.flip);

      expect(error).toMatchObject({
        code: "artifact.invalidRecord",
        context: {
          recordNumber: 2,
        },
      });
    }),
  );

  it.effect("rejects non-trimmed or empty conversation IDs", () =>
    Effect.gen(function* () {
      const path = yield* Effect.promise(() => tempPath("bad-conversation-id.jsonl.gz"));
      yield* writeRawArtifact(path, [
        manifest,
        {
          type: "workItemConversationLinks",
          spaceKey: "ENG",
          workItemKey: "ENG-1",
          conversationIds: ["abc", "  "],
        },
      ]);

      const error = yield* readFixture(path).pipe(Effect.flip);

      expect(error).toMatchObject({
        code: "artifact.invalidRecord",
        context: {
          recordNumber: 2,
        },
      });
    }),
  );
});
