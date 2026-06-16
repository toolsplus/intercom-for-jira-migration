import { Effect, Layer, Stream } from "effect";
import { describe, expect, it } from "@effect/vitest";

import { JiraClient } from "../shared/jira/index.js";
import { ImportJiraService } from "./jira.service.js";

const defaultJiraClient: JiraClient["Service"] = {
  getMyPermissions: () => Effect.succeed({ ADMINISTER: { havePermission: true } }),
  searchProjectSpaces: () => Stream.empty,
  approximateSearchCount: () => Effect.succeed(0),
  searchWorkItems: () => Stream.empty,
  writeProjectProperty: () => Effect.void,
  bulkFetchWorkItems: () => Effect.succeed([]),
  submitIssuePropertyBulkTask: () =>
    Effect.succeed("https://example.atlassian.net/rest/api/3/task/task-1"),
  getTask: () => Effect.succeed({ status: "COMPLETE" }),
};

const successfulBulkTaskResult = {
  failedEntities: {},
  errors: {
    errors: {},
    errorMessages: [],
    reasons: [],
  },
};

const importJiraLayerFromClient = (jiraClient: JiraClient["Service"]) =>
  ImportJiraService.layer.pipe(Layer.provide(Layer.succeed(JiraClient, JiraClient.of(jiraClient))));

describe("import Jira service", () => {
  it.effect("matches target space keys case-insensitively", () =>
    Effect.gen(function* () {
      const available = yield* ImportJiraService.use((service) =>
        service.targetSpaceAvailable("eng"),
      ).pipe(
        Effect.provide(
          importJiraLayerFromClient({
            ...defaultJiraClient,
            searchProjectSpaces: () => Stream.fromIterable([{ key: "ENG", properties: {} }]),
          }),
        ),
      );

      expect(available).toBe(true);
    }),
  );

  it.effect(
    "resolves work items by returned key when Jira returns bulk fetch results out of order",
    () =>
      Effect.gen(function* () {
        const resolved = yield* ImportJiraService.use((service) =>
          service.resolveWorkItems(["ENG-2", "ENG-1"]),
        ).pipe(
          Effect.provide(
            importJiraLayerFromClient({
              ...defaultJiraClient,
              bulkFetchWorkItems: () =>
                Effect.succeed([
                  { id: "10001", key: "ENG-1" },
                  { id: "10002", key: "ENG-2" },
                ]),
            }),
          ),
        );

        expect(resolved).toEqual([
          { requestedKey: "ENG-2", id: "10002", key: "ENG-2" },
          { requestedKey: "ENG-1", id: "10001", key: "ENG-1" },
        ]);
      }),
  );

  it.effect("resolves work items case-insensitively", () =>
    Effect.gen(function* () {
      const resolved = yield* ImportJiraService.use((service) =>
        service.resolveWorkItems(["eng-1"]),
      ).pipe(
        Effect.provide(
          importJiraLayerFromClient({
            ...defaultJiraClient,
            bulkFetchWorkItems: () => Effect.succeed([{ id: "10001", key: "ENG-1" }]),
          }),
        ),
      );

      expect(resolved).toEqual([{ requestedKey: "eng-1", id: "10001", key: "ENG-1" }]);
    }),
  );

  it.effect("accepts completed bulk property tasks with an empty result", () =>
    Effect.gen(function* () {
      let submitted = 0;

      yield* ImportJiraService.use((service) =>
        service.writeWorkItemConversationLinks("ENG", [
          { issueId: "10001", value: { count: 1, conversationIds: ["abc"] } },
        ]),
      ).pipe(
        Effect.provide(
          importJiraLayerFromClient({
            ...defaultJiraClient,
            submitIssuePropertyBulkTask: () =>
              Effect.sync(() => {
                submitted += 1;
                return "https://example.atlassian.net/rest/api/3/task/task-1";
              }),
            getTask: () => Effect.succeed({ status: "COMPLETE", result: successfulBulkTaskResult }),
          }),
        ),
      );

      expect(submitted).toBe(1);
    }),
  );

  it.effect("fails completed bulk property tasks with failed entities", () =>
    Effect.gen(function* () {
      const error = yield* ImportJiraService.use((service) =>
        service.writeWorkItemConversationLinks("ENG", [
          { issueId: "10001", value: { count: 1, conversationIds: ["abc"] } },
        ]),
      ).pipe(
        Effect.flip,
        Effect.provide(
          importJiraLayerFromClient({
            ...defaultJiraClient,
            getTask: () =>
              Effect.succeed({
                status: "COMPLETE",
                result: {
                  ...successfulBulkTaskResult,
                  failedEntities: {
                    "10001": ["Could not update property."],
                  },
                },
              }),
          }),
        ),
      );

      expect(error).toMatchObject({
        code: "import.bulkTaskFailed",
        message: "Jira bulk issue property task reported failed entities or errors.",
      });
    }),
  );

  it.effect("fails closed when a completed bulk property task has no recognizable result", () =>
    Effect.gen(function* () {
      const error = yield* ImportJiraService.use((service) =>
        service.writeWorkItemConversationLinks("ENG", [
          { issueId: "10001", value: { count: 1, conversationIds: ["abc"] } },
        ]),
      ).pipe(
        Effect.flip,
        Effect.provide(
          importJiraLayerFromClient({
            ...defaultJiraClient,
            getTask: () => Effect.succeed({ status: "COMPLETE" }),
          }),
        ),
      );

      expect(error).toMatchObject({
        code: "import.bulkTaskFailed",
        message: "Jira bulk issue property task returned an unrecognized result.",
      });
    }),
  );
});
