import { Context, Effect, Layer, Stream } from "effect";

import { AppError } from "../errors.js";
import { ArtifactReaderService, type ArtifactRecord } from "../shared/artifact/index.js";
import type { InspectState, InspectSummary } from "./inspect.model.js";

const emptyInspectState = (): InspectState => ({
  manifest: undefined,
  spaceKeys: new Set<string>(),
  spaceConfigurationRecords: 0,
  workItemConversationLinkRecords: 0,
  conversationIds: 0,
});

const accumulateInspectState = (state: InspectState, record: ArtifactRecord): InspectState => {
  switch (record.type) {
    case "manifest":
      return { ...state, manifest: record };
    case "spaceConfiguration": {
      const spaceKeys = new Set(state.spaceKeys).add(record.spaceKey);
      return {
        ...state,
        spaceKeys,
        spaceConfigurationRecords: state.spaceConfigurationRecords + 1,
      };
    }
    case "workItemConversationLinks": {
      const spaceKeys = new Set(state.spaceKeys).add(record.spaceKey);
      return {
        ...state,
        spaceKeys,
        workItemConversationLinkRecords: state.workItemConversationLinkRecords + 1,
        conversationIds: state.conversationIds + record.conversationIds.length,
      };
    }
  }
};

const inspectArtifact = (
  path: string,
): Effect.Effect<InspectSummary, AppError, ArtifactReaderService> =>
  Effect.gen(function* () {
    const reader = yield* ArtifactReaderService;

    return yield* reader.read(path).pipe(
      Stream.runFold(emptyInspectState, accumulateInspectState),
      Effect.flatMap((state) =>
        state.manifest === undefined
          ? Effect.fail(
              new AppError(
                "artifact.manifestMissing",
                "Artifact is empty or missing its manifest.",
              ),
            )
          : Effect.succeed({
              artifactPath: path,
              source: state.manifest.source,
              createdAt: state.manifest.createdAt,
              spacesProcessed: state.spaceKeys.size,
              spaceConfigurationRecords: state.spaceConfigurationRecords,
              workItemConversationLinkRecords: state.workItemConversationLinkRecords,
              conversationIds: state.conversationIds,
            }),
      ),
    );
  });

export class InspectService extends Context.Service<
  InspectService,
  {
    readonly run: (path: string) => Effect.Effect<InspectSummary, AppError>;
  }
>()("ifj/InspectService") {
  static readonly layerNoDeps: Layer.Layer<InspectService, never, ArtifactReaderService> =
    Layer.effect(
      InspectService,
      ArtifactReaderService.pipe(
        Effect.map((reader) =>
          InspectService.of({
            run: (path) =>
              inspectArtifact(path).pipe(Effect.provideService(ArtifactReaderService, reader)),
          }),
        ),
      ),
    );

  static readonly layer = InspectService.layerNoDeps.pipe(
    Layer.provide(ArtifactReaderService.layer),
  );
}
