import { Effect, Fiber, Layer, Redacted, Stream } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/unstable/http";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "@effect/vitest";

import { JiraClient } from "./jira.client.js";

const testCredentials = {
  siteUrl: "https://example.atlassian.net",
  user: "admin@example.com",
  apiToken: Redacted.make("secret"),
};

const jiraClientLayer = <E, R>(
  httpLayer: Layer.Layer<HttpClient.HttpClient, E, R>,
): Layer.Layer<JiraClient, E, R> =>
  JiraClient.layerNoDeps(testCredentials).pipe(Layer.provide(httpLayer));

describe("Jira HTTP client", () => {
  it.effect("uses the Effect HTTP client with auth headers and decodes Jira responses", () =>
    Effect.gen(function* () {
      const requests: { readonly url: string; readonly authorization: string | undefined }[] = [];
      const httpLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request, url) =>
          Effect.sync(() => {
            requests.push({
              url: url.toString(),
              authorization: request.headers["authorization"],
            });
            return HttpClientResponse.fromWeb(
              request,
              new Response(
                JSON.stringify({
                  permissions: {
                    ADMINISTER: {
                      havePermission: true,
                    },
                  },
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              ),
            );
          }),
        ),
      );

      const permissions = yield* Effect.gen(function* () {
        const jiraClient = yield* JiraClient;
        return yield* jiraClient.getMyPermissions(["ADMINISTER"]);
      }).pipe(Effect.provide(jiraClientLayer(httpLayer)));

      expect(permissions["ADMINISTER"]?.havePermission).toBe(true);
      expect(requests).toEqual([
        {
          url: "https://example.atlassian.net/rest/api/3/mypermissions?permissions=ADMINISTER",
          authorization: "Basic YWRtaW5AZXhhbXBsZS5jb206c2VjcmV0",
        },
      ]);
    }),
  );

  it.effect("retries transient HTTP transport failures before decoding Jira responses", () =>
    Effect.gen(function* () {
      let requestCount = 0;
      const httpLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.gen(function* () {
            requestCount += 1;
            if (requestCount === 1) {
              return yield* new HttpClientError.HttpClientError({
                reason: new HttpClientError.TransportError({
                  request,
                  cause: new Error("connection reset"),
                }),
              });
            }
            return HttpClientResponse.fromWeb(
              request,
              new Response(
                JSON.stringify({
                  permissions: {
                    ADMINISTER: {
                      havePermission: true,
                    },
                  },
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              ),
            );
          }),
        ),
      );

      const fiber = yield* Effect.gen(function* () {
        const jiraClient = yield* JiraClient;
        yield* jiraClient.getMyPermissions(["ADMINISTER"]);
      }).pipe(Effect.provide(jiraClientLayer(httpLayer)), Effect.forkChild);
      yield* Effect.yieldNow;
      expect(requestCount).toBe(1);

      yield* TestClock.adjust("250 millis");
      yield* Fiber.join(fiber);
      expect(requestCount).toBe(2);
    }),
  );

  it.effect("retries retryable Jira status responses before decoding Jira responses", () =>
    Effect.gen(function* () {
      let requestCount = 0;
      const httpLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() => {
            requestCount += 1;
            return HttpClientResponse.fromWeb(
              request,
              requestCount === 1
                ? new Response("Service unavailable", { status: 503 })
                : new Response(
                    JSON.stringify({
                      permissions: {
                        ADMINISTER: {
                          havePermission: true,
                        },
                      },
                    }),
                    { status: 200, headers: { "Content-Type": "application/json" } },
                  ),
            );
          }),
        ),
      );

      const fiber = yield* Effect.gen(function* () {
        const jiraClient = yield* JiraClient;
        yield* jiraClient.getMyPermissions(["ADMINISTER"]);
      }).pipe(Effect.provide(jiraClientLayer(httpLayer)), Effect.forkChild);
      yield* Effect.yieldNow;
      expect(requestCount).toBe(1);

      yield* TestClock.adjust("250 millis");
      yield* Fiber.join(fiber);
      expect(requestCount).toBe(2);
    }),
  );

  it.effect("searches projects with query params and properties", () =>
    Effect.gen(function* () {
      const requests: string[] = [];
      const httpLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request, url) =>
          Effect.sync(() => {
            requests.push(url.toString());
            return HttpClientResponse.fromWeb(
              request,
              new Response(
                JSON.stringify({
                  values: [
                    {
                      id: "10000",
                      key: "ENG",
                      name: "Engineering",
                      properties: {
                        "example.property": { enabled: true },
                      },
                    },
                  ],
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              ),
            );
          }),
        ),
      );

      const spaces = yield* Effect.gen(function* () {
        const jiraClient = yield* JiraClient;
        return yield* jiraClient
          .searchProjectSpaces({
            propertyQuery: "[intercomIntegrationStatus]=true",
            properties: ["example.property"],
          })
          .pipe(Stream.runCollect);
      }).pipe(Effect.provide(jiraClientLayer(httpLayer)));

      expect(spaces.map((space) => space.key)).toEqual(["ENG"]);
      expect(spaces[0]?.properties).toEqual({ "example.property": { enabled: true } });

      const searchUrl = new URL(requests[0] ?? "");
      expect(searchUrl.pathname).toBe("/rest/api/3/project/search");
      expect(searchUrl.searchParams.get("properties")).toBe("example.property");
      expect(searchUrl.searchParams.get("propertyQuery")).toBe("[intercomIntegrationStatus]=true");
      expect(searchUrl.searchParams.getAll("keys")).toEqual([]);
    }),
  );

  it.effect("passes project search keys without adding domain validation", () =>
    Effect.gen(function* () {
      const requests: string[] = [];
      const httpLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request, url) =>
          Effect.sync(() => {
            requests.push(url.toString());
            return HttpClientResponse.fromWeb(
              request,
              new Response(
                JSON.stringify({
                  values: [
                    {
                      key: "ENG",
                      properties: {
                        "example.property": { enabled: true },
                      },
                    },
                    {
                      key: "OPS",
                    },
                  ],
                }),
                { status: 200, headers: { "Content-Type": "application/json" } },
              ),
            );
          }),
        ),
      );

      const spaces = yield* Effect.gen(function* () {
        const jiraClient = yield* JiraClient;
        return yield* jiraClient
          .searchProjectSpaces({ keys: ["eng", "OPS"], properties: ["example.property"] })
          .pipe(Stream.runCollect);
      }).pipe(Effect.provide(jiraClientLayer(httpLayer)));

      expect(spaces.map((space) => space.key)).toEqual(["ENG", "OPS"]);
      expect(spaces[0]?.properties).toEqual({ "example.property": { enabled: true } });
      expect(spaces[1]?.properties).toEqual({});

      const searchUrl = new URL(requests[0] ?? "");
      expect(searchUrl.pathname).toBe("/rest/api/3/project/search");
      expect(searchUrl.searchParams.get("properties")).toBe("example.property");
      expect(searchUrl.searchParams.get("propertyQuery")).toBeNull();
      expect(searchUrl.searchParams.getAll("keys")).toEqual(["eng", "OPS"]);
    }),
  );

  it.effect("counts work items with the approximate count endpoint and caller-provided JQL", () =>
    Effect.gen(function* () {
      const requests: {
        readonly method: string;
        readonly url: string;
        readonly contentType: string | undefined;
        readonly body: unknown;
      }[] = [];
      const httpLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request, url) =>
          Effect.sync(() => {
            requests.push({
              method: request.method,
              url: url.toString(),
              contentType: request.headers["content-type"],
              body: request.body.toJSON(),
            });
            return HttpClientResponse.fromWeb(
              request,
              new Response(JSON.stringify({ count: 153 }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            );
          }),
        ),
      );

      const count = yield* Effect.gen(function* () {
        const jiraClient = yield* JiraClient;
        return yield* jiraClient.approximateSearchCount(
          'project in ("ENG", "OPS") AND linkedIntercomConversationCount > 0',
        );
      }).pipe(Effect.provide(jiraClientLayer(httpLayer)));

      expect(count).toBe(153);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.method).toBe("POST");
      expect(requests[0]?.contentType).toBe("application/json");
      expect(requests[0]?.body).toMatchObject({
        _id: "effect/HttpBody",
        _tag: "Uint8Array",
        body: JSON.stringify({
          jql: 'project in ("ENG", "OPS") AND linkedIntercomConversationCount > 0',
        }),
        contentType: "application/json",
      });

      const countUrl = new URL(requests[0]?.url ?? "");
      expect(countUrl.pathname).toBe("/rest/api/3/search/approximate-count");
      expect(countUrl.search).toBe("");
    }),
  );

  it.effect("searches work items with caller-provided properties", () =>
    Effect.gen(function* () {
      const requests: {
        readonly method: string;
        readonly url: string;
        readonly contentType: string | undefined;
        readonly body: unknown;
      }[] = [];
      const httpLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request, url) =>
          Effect.sync(() => {
            requests.push({
              method: request.method,
              url: url.toString(),
              contentType: request.headers["content-type"],
              body: request.body.toJSON(),
            });
            return HttpClientResponse.fromWeb(
              request,
              new Response(
                JSON.stringify({
                  isLast: true,
                  issues: [
                    {
                      key: "ENG-1",
                      properties: {
                        "example.property": { count: 1, conversationIds: ["abc"] },
                      },
                    },
                  ],
                }),
                {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                },
              ),
            );
          }),
        ),
      );

      const hits: { readonly key: string; readonly properties: Record<string, unknown> }[] = [];
      yield* Effect.gen(function* () {
        const jiraClient = yield* JiraClient;
        yield* jiraClient
          .searchWorkItems({
            jql: 'project in ("ENG") AND linkedIntercomConversationCount > 0 ORDER BY key ASC',
            fields: ["key"],
            properties: ["example.property"],
          })
          .pipe(
            Stream.runForEach((hit) =>
              Effect.sync(() => {
                hits.push(hit);
              }),
            ),
          );
      }).pipe(Effect.provide(jiraClientLayer(httpLayer)));

      expect(hits).toEqual([
        {
          key: "ENG-1",
          properties: { "example.property": { count: 1, conversationIds: ["abc"] } },
        },
      ]);
      expect(requests).toHaveLength(1);
      expect(requests[0]?.method).toBe("POST");
      expect(requests[0]?.contentType).toBe("application/json");
      expect(requests[0]?.body).toMatchObject({
        _id: "effect/HttpBody",
        _tag: "Uint8Array",
        body: JSON.stringify({
          jql: 'project in ("ENG") AND linkedIntercomConversationCount > 0 ORDER BY key ASC',
          maxResults: 100,
          fields: ["key"],
          properties: ["example.property"],
        }),
        contentType: "application/json",
      });

      const searchUrl = new URL(requests[0]?.url ?? "");
      expect(searchUrl.pathname).toBe("/rest/api/3/search/jql");
      expect(searchUrl.search).toBe("");
    }),
  );

  it.effect("submits per-issue property updates and returns the Jira task location", () =>
    Effect.gen(function* () {
      const requests: {
        readonly method: string;
        readonly url: string;
        readonly contentType: string | undefined;
        readonly body: unknown;
      }[] = [];
      const httpLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request, url) =>
          Effect.sync(() => {
            requests.push({
              method: request.method,
              url: url.toString(),
              contentType: request.headers["content-type"],
              body: request.body.toJSON(),
            });
            return HttpClientResponse.fromWeb(
              request,
              new Response(null, {
                status: 303,
                headers: {
                  Location: "https://example.atlassian.net/rest/api/3/task/task-1",
                },
              }),
            );
          }),
        ),
      );

      const taskLocation = yield* Effect.gen(function* () {
        const jiraClient = yield* JiraClient;
        return yield* jiraClient.submitIssuePropertyBulkTask("example.property", [
          { issueId: "10001", value: { count: 2, conversationIds: ["a", "b"] } },
          { issueId: "10002", value: { count: 1, conversationIds: ["c"] } },
        ]);
      }).pipe(Effect.provide(jiraClientLayer(httpLayer)));

      expect(taskLocation).toBe("https://example.atlassian.net/rest/api/3/task/task-1");
      expect(requests).toHaveLength(1);
      expect(requests[0]?.method).toBe("POST");
      expect(requests[0]?.contentType).toBe("application/json");
      expect(requests[0]?.body).toMatchObject({
        _id: "effect/HttpBody",
        _tag: "Uint8Array",
        body: JSON.stringify({
          issues: [
            {
              issueID: 10001,
              properties: {
                "example.property": { count: 2, conversationIds: ["a", "b"] },
              },
            },
            {
              issueID: 10002,
              properties: {
                "example.property": { count: 1, conversationIds: ["c"] },
              },
            },
          ],
        }),
        contentType: "application/json",
      });

      const writeUrl = new URL(requests[0]?.url ?? "");
      expect(writeUrl.pathname).toBe("/rest/api/3/issue/properties/multi");
      expect(writeUrl.search).toBe("");
    }),
  );

  it.effect("gets a task from a Jira task location", () =>
    Effect.gen(function* () {
      const requests: string[] = [];
      const httpLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request, url) =>
          Effect.sync(() => {
            requests.push(url.toString());
            return HttpClientResponse.fromWeb(
              request,
              new Response(JSON.stringify({ status: "COMPLETE" }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            );
          }),
        ),
      );

      const task = yield* Effect.gen(function* () {
        const jiraClient = yield* JiraClient;
        return yield* jiraClient.getTask("https://example.atlassian.net/rest/api/3/task/task-1");
      }).pipe(Effect.provide(jiraClientLayer(httpLayer)));

      expect(task.status).toBe("COMPLETE");
      expect(requests).toEqual(["https://example.atlassian.net/rest/api/3/task/task-1"]);
    }),
  );

  it.effect("rejects cross-origin Jira task locations", () =>
    Effect.gen(function* () {
      let requestCount = 0;
      const httpLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request, url) =>
          Effect.sync(() => {
            requestCount += 1;
            return HttpClientResponse.fromWeb(
              request,
              new Response(JSON.stringify({ status: "COMPLETE", url: url.toString() }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            );
          }),
        ),
      );

      const error = yield* Effect.gen(function* () {
        const jiraClient = yield* JiraClient;
        return yield* jiraClient.getTask("https://other.example.net/rest/api/3/task/task-1");
      }).pipe(Effect.provide(jiraClientLayer(httpLayer)), Effect.flip);

      expect(error).toMatchObject({
        code: "jira.malformed",
        message: "Jira returned a task location for another site.",
      });
      expect(requestCount).toBe(0);
    }),
  );

  it.effect("continues work item search when Jira returns a next page token", () =>
    Effect.gen(function* () {
      const requests: {
        readonly body: unknown;
      }[] = [];
      const httpLayer = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() => {
            requests.push({
              body: request.body.toJSON(),
            });
            return HttpClientResponse.fromWeb(
              request,
              new Response(
                JSON.stringify(
                  requests.length === 1
                    ? {
                        issues: [{ key: "ENG-1" }],
                        nextPageToken: "page-2",
                      }
                    : {
                        issues: [{ key: "ENG-2" }],
                      },
                ),
                {
                  status: 200,
                  headers: { "Content-Type": "application/json" },
                },
              ),
            );
          }),
        ),
      );

      const hits = yield* Effect.gen(function* () {
        const jiraClient = yield* JiraClient;
        return yield* jiraClient
          .searchWorkItems({
            jql: 'project in ("ENG") ORDER BY key ASC',
          })
          .pipe(Stream.runCollect);
      }).pipe(Effect.provide(jiraClientLayer(httpLayer)));

      expect(hits.map((hit) => hit.key)).toEqual(["ENG-1", "ENG-2"]);
      expect(requests).toHaveLength(2);
      expect(requests[0]?.body).toMatchObject({
        body: JSON.stringify({
          jql: 'project in ("ENG") ORDER BY key ASC',
          maxResults: 100,
        }),
      });
      expect(requests[1]?.body).toMatchObject({
        body: JSON.stringify({
          jql: 'project in ("ENG") ORDER BY key ASC',
          maxResults: 100,
          nextPageToken: "page-2",
        }),
      });
    }),
  );
});
