import { Buffer } from "node:buffer";
import { NodeHttpClient } from "@effect/platform-node";
import { Context, Effect, Layer, Option, Redacted, Stream } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import { AppError } from "../../errors.js";
import {
  ApproximateSearchCountRequest,
  CountResponse,
  type JiraCredentials,
  type JiraPermissions,
  type JiraProjectSpace,
  type JiraSearchProjectSpacesParams,
  type JiraSearchWorkItemsParams,
  type JiraWorkItem,
  PermissionResponse,
  ProjectSearch,
  SearchResponse,
  SearchWorkItemsRequest,
} from "./jira.model.js";
import { jiraStatusFailure, sendWithRetry } from "./retry.util.js";

const pageSize = 100;

export class JiraClient extends Context.Service<
  JiraClient,
  {
    readonly getMyPermissions: (
      permissions: readonly string[],
    ) => Effect.Effect<JiraPermissions, AppError>;
    readonly searchProjectSpaces: (
      params: JiraSearchProjectSpacesParams,
    ) => Stream.Stream<JiraProjectSpace, AppError>;
    readonly approximateSearchCount: (jql: string) => Effect.Effect<number, AppError>;
    readonly searchWorkItems: (
      params: JiraSearchWorkItemsParams,
    ) => Stream.Stream<JiraWorkItem, AppError>;
  }
>()("ifj/JiraClient") {
  static layerNoDeps(
    credentials: JiraCredentials,
  ): Layer.Layer<JiraClient, never, HttpClient.HttpClient> {
    return Layer.effect(JiraClient, makeJiraClient(credentials));
  }

  static layer(credentials: JiraCredentials): Layer.Layer<JiraClient> {
    return JiraClient.layerNoDeps(credentials).pipe(Layer.provide(NodeHttpClient.layerFetch));
  }
}

const makeJiraClient = (
  credentials: JiraCredentials,
): Effect.Effect<JiraClient["Service"], never, HttpClient.HttpClient> =>
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const authHeader = `Basic ${Buffer.from(
      `${credentials.user}:${Redacted.value(credentials.apiToken)}`,
      "utf8",
    ).toString("base64")}`;

    const requestHeaders = {
      Authorization: authHeader,
      Accept: "application/json",
    };
    const apiUrl = (path: string): URL => new URL(path, credentials.source);

    const getMyPermissions = Effect.fn("JiraClient.getMyPermissions")(function* (
      permissions: readonly string[],
    ) {
      const params = new URLSearchParams({ permissions: permissions.join(",") });
      const path = `/rest/api/3/mypermissions?${params.toString()}`;
      const context = { method: "GET", path };
      const decoded = yield* sendWithRetry(
        context,
        httpClient.get(apiUrl(path), { headers: requestHeaders }),
        (response) =>
          HttpClientResponse.matchStatus(response, {
            "2xx": (response) =>
              HttpClientResponse.schemaBodyJson(PermissionResponse)(response).pipe(
                Effect.mapError(
                  (cause) =>
                    new AppError(
                      "jira.malformed",
                      "Jira returned a malformed permission response.",
                      {
                        context: { path },
                        cause,
                      },
                    ),
                ),
              ),
            orElse: (response) => jiraStatusFailure(response, context),
          }),
      );
      return decoded.permissions;
    });

    const searchProjectSpaces = (
      params: JiraSearchProjectSpacesParams,
    ): Stream.Stream<JiraProjectSpace, AppError> =>
      Stream.paginate(0, (startAt) => {
        const path = `/rest/api/3/project/search?${new URLSearchParams([
          ...(params.keys ?? []).map((key) => ["keys", key]),
          ...(params.properties ?? []).map((property) => ["properties", property]),
          ...(params.propertyQuery === undefined ? [] : [["propertyQuery", params.propertyQuery]]),
          ["startAt", String(startAt)],
          ["maxResults", String(pageSize)],
        ]).toString()}`;
        const context = { method: "GET", path };

        return sendWithRetry(
          context,
          httpClient.get(apiUrl(path), { headers: requestHeaders }),
          (response) =>
            HttpClientResponse.matchStatus(response, {
              404: () =>
                Effect.succeed([[] as readonly JiraProjectSpace[], Option.none<number>()] as const),
              "2xx": (response) =>
                HttpClientResponse.schemaBodyJson(ProjectSearch)(response).pipe(
                  Effect.mapError(
                    (cause) =>
                      new AppError(
                        "jira.malformed",
                        "Jira returned a malformed space search response.",
                        {
                          context: { path: "/rest/api/3/project/search" },
                          cause,
                        },
                      ),
                  ),
                  Effect.map(
                    (decoded) =>
                      [
                        decoded.values,
                        decoded.values.length < pageSize
                          ? Option.none<number>()
                          : Option.some(startAt + decoded.values.length),
                      ] as const,
                  ),
                ),
              orElse: (response) => jiraStatusFailure(response, context),
            }),
        );
      });

    const approximateSearchCount = Effect.fn("JiraClient.approximateSearchCount")(function* (
      jql: string,
    ) {
      const path = "/rest/api/3/search/approximate-count";
      const context = { method: "POST", path, jql };
      const request = yield* HttpClientRequest.post(apiUrl(path), { headers: requestHeaders }).pipe(
        HttpClientRequest.schemaBodyJson(ApproximateSearchCountRequest)({ jql }),
        Effect.mapError(
          (cause) =>
            new AppError("jira.malformed", "Could not encode Jira request body.", {
              context,
              cause,
            }),
        ),
      );
      const decoded = yield* sendWithRetry(context, httpClient.execute(request), (response) =>
        HttpClientResponse.matchStatus(response, {
          "2xx": (response) =>
            HttpClientResponse.schemaBodyJson(CountResponse)(response).pipe(
              Effect.mapError(
                (cause) =>
                  new AppError(
                    "jira.malformed",
                    "Jira returned a malformed approximate count response.",
                    {
                      context: { path, jql },
                      cause,
                    },
                  ),
              ),
            ),
          orElse: (response) => jiraStatusFailure(response, context),
        }),
      );
      return decoded.count;
    });

    const searchWorkItems = (
      params: JiraSearchWorkItemsParams,
    ): Stream.Stream<JiraWorkItem, AppError> =>
      Stream.paginate(Option.none<string>(), (nextPageToken) =>
        Effect.gen(function* () {
          const path = "/rest/api/3/search/jql";
          const context = { method: "POST", path, jql: params.jql };
          const request = yield* HttpClientRequest.post(apiUrl(path), {
            headers: requestHeaders,
          }).pipe(
            HttpClientRequest.schemaBodyJson(SearchWorkItemsRequest)({
              jql: params.jql,
              maxResults: pageSize,
              ...(params.fields === undefined ? {} : { fields: params.fields }),
              ...(params.properties === undefined ? {} : { properties: params.properties }),
              ...(Option.isNone(nextPageToken) ? {} : { nextPageToken: nextPageToken.value }),
            }),
            Effect.mapError(
              (cause) =>
                new AppError("jira.malformed", "Could not encode Jira request body.", {
                  context,
                  cause,
                }),
            ),
          );
          const response = yield* sendWithRetry(context, httpClient.execute(request), (response) =>
            HttpClientResponse.matchStatus(response, {
              "2xx": (response) =>
                HttpClientResponse.schemaBodyJson(SearchResponse)(response).pipe(
                  Effect.mapError(
                    (cause) =>
                      new AppError("jira.malformed", "Jira returned a malformed search response.", {
                        context: { path, jql: params.jql },
                        cause,
                      }),
                  ),
                ),
              orElse: (response) => jiraStatusFailure(response, context),
            }),
          );
          return [
            response.issues,
            response.nextPageToken === undefined
              ? Option.none<Option.Option<string>>()
              : Option.some(Option.some(response.nextPageToken)),
          ] as const;
        }),
      );

    return JiraClient.of({
      getMyPermissions,
      searchProjectSpaces,
      approximateSearchCount,
      searchWorkItems,
    });
  });
