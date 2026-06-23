import { Cause, Console, Duration, Effect, Option, Schedule, Schema } from "effect";
import { Headers } from "effect/unstable/http";
import type { HttpClientResponse } from "effect/unstable/http";

import { AppError } from "../../errors.js";

type ResponseHeaders = Headers.Headers;

interface RetryPolicy {
  readonly maxAttempts: number;
  readonly requestTimeoutMillis: number;
  readonly baseDelayMillis: number;
  readonly retryableStatuses: ReadonlySet<number>;
}

export const defaultRetryPolicy: RetryPolicy = {
  maxAttempts: 4,
  requestTimeoutMillis: 60_000,
  baseDelayMillis: 250,
  retryableStatuses: new Set([429, 500, 502, 503, 504]),
};

const ResponseHeadersSchema = Schema.Record(Schema.String, Schema.String);

const rateLimitHeaders = (headers: ResponseHeaders): Record<string, string> => {
  const allowed: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.toLowerCase();
    if (
      normalized === "retry-after" ||
      normalized === "beta-retry-after" ||
      normalized === "ratelimit-reason" ||
      normalized.startsWith("x-ratelimit") ||
      normalized.startsWith("x-beta-ratelimit") ||
      normalized.startsWith("beta-ratelimit")
    ) {
      allowed[normalized] = value;
    }
  }
  return allowed;
};

const firstHeader = (headers: ResponseHeaders, names: readonly string[]): string | undefined => {
  for (const name of names) {
    const value = Option.getOrUndefined(Headers.get(headers, name));
    if (value !== undefined && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
};

const formatRateLimitHeaders = (headers: ResponseHeaders): string => {
  const parts: string[] = [];
  const limit = firstHeader(headers, ["x-ratelimit-limit", "x-beta-ratelimit-limit"]);
  const remaining = firstHeader(headers, ["x-ratelimit-remaining", "x-beta-ratelimit-remaining"]);
  const nearLimit = firstHeader(headers, ["x-ratelimit-nearlimit", "x-beta-ratelimit-nearlimit"]);
  const reason = firstHeader(headers, ["ratelimit-reason", "x-beta-ratelimit-reason"]);
  const retryAfter = firstHeader(headers, ["retry-after", "beta-retry-after"]);

  if (limit !== undefined) {
    parts.push(`limit=${limit}`);
  }
  if (remaining !== undefined) {
    parts.push(`remaining=${remaining}`);
  }
  if (nearLimit?.toLowerCase() === "true") {
    parts.push("nearLimit=true");
  }
  if (reason !== undefined) {
    parts.push(`reason=${reason}`);
  }
  if (retryAfter !== undefined) {
    parts.push(`retryAfter=${retryAfter}${/^\d+$/u.test(retryAfter) ? "s" : ""}`);
  }

  return parts.length === 0 ? "" : `; rateLimit ${parts.join(", ")}`;
};

const contextText = (context: Record<string, unknown>, key: string, fallback: string): string => {
  const value = context[key];
  return typeof value === "string" ? value : fallback;
};

const logRateLimitWarning = (
  response: HttpClientResponse.HttpClientResponse,
  context: Record<string, unknown>,
): Effect.Effect<void> =>
  response.status < 400 &&
  firstHeader(response.headers, [
    "x-ratelimit-nearlimit",
    "x-beta-ratelimit-nearlimit",
  ])?.toLowerCase() === "true"
    ? Console.error(
        `Jira rate limit warning on ${contextText(context, "method", "request")} ${contextText(
          context,
          "path",
          "",
        )}${formatRateLimitHeaders(response.headers)}.`,
      )
    : Effect.void;

const retryAfterMs = (headers: ResponseHeaders, nowMillis: number): number | undefined => {
  const retryAfter = firstHeader(headers, ["retry-after", "beta-retry-after"]);
  if (retryAfter === undefined) {
    return undefined;
  }
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const dateMs = Date.parse(retryAfter);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - nowMillis) : undefined;
};

const retryDelay = (
  policy: RetryPolicy,
  headers: ResponseHeaders,
  attempt: number,
  nowMillis: number,
): number => retryAfterMs(headers, nowMillis) ?? policy.baseDelayMillis * 2 ** (attempt - 1);

const transientRequestError = (cause: unknown, context: Record<string, unknown>): AppError =>
  new AppError("jira.transient", "Jira request failed.", {
    cause,
    context: {
      ...context,
      headers: rateLimitHeaders(Headers.empty),
      retryable: true,
    },
  });

const retryableErrorHeaders = (error: AppError): ResponseHeaders => {
  const headers = Schema.decodeUnknownOption(ResponseHeadersSchema)(error.context["headers"]);
  return Option.match(headers, {
    onNone: () => Headers.empty,
    onSome: Headers.fromInput,
  });
};

const isRetryableError = (error: AppError): boolean =>
  error.code === "jira.transient" && error.context["retryable"] === true;

const retryLogLine = (
  context: Record<string, unknown>,
  error: AppError,
  delayMillis: number,
  attempt: number,
  policy: RetryPolicy,
): string => {
  const status = error.context["status"];
  const retryKind = status === 429 ? "Jira rate limit" : "Retryable Jira request failure";
  return `${retryKind}: Retrying ${contextText(context, "method", "request")} ${contextText(
    context,
    "path",
    "",
  )} in ${Duration.format(Duration.millis(delayMillis))} (attempt ${String(attempt + 1)}/${String(
    policy.maxAttempts,
  )})${formatRateLimitHeaders(retryableErrorHeaders(error))}.`;
};

export const jiraStatusFailure = (
  response: HttpClientResponse.HttpClientResponse,
  context: Record<string, unknown>,
  policy: RetryPolicy = defaultRetryPolicy,
): Effect.Effect<never, AppError> =>
  response.text.pipe(
    Effect.option,
    Effect.flatMap((body) => {
      const failureContext = {
        ...context,
        status: response.status,
        ...body.pipe(
          Option.map((b) => ({ body: b })),
          Option.getOrElse(() => ({})),
        ),
      };
      if (response.status === 401) {
        return Effect.fail(
          new AppError("jira.auth", "Jira authentication failed.", {
            context: failureContext,
          }),
        );
      }
      if (response.status === 403) {
        return Effect.fail(
          new AppError("jira.permission", "Jira authorization failed.", {
            context: failureContext,
          }),
        );
      }
      if (policy.retryableStatuses.has(response.status)) {
        return Effect.fail(
          new AppError(
            "jira.transient",
            `Jira request failed with status ${String(response.status)}.`,
            {
              context: {
                ...failureContext,
                headers: rateLimitHeaders(response.headers),
                retryable: true,
              },
            },
          ),
        );
      }
      return Effect.fail(
        new AppError(
          "jira.request",
          `Jira request failed with status ${String(response.status)}.`,
          {
            context: failureContext,
          },
        ),
      );
    }),
  );

export const sendWithRetry = <A>(
  context: Record<string, unknown>,
  request: Effect.Effect<HttpClientResponse.HttpClientResponse, unknown>,
  handleResponse: (response: HttpClientResponse.HttpClientResponse) => Effect.Effect<A, AppError>,
  policy: RetryPolicy = defaultRetryPolicy,
): Effect.Effect<A, AppError> =>
  request.pipe(
    Effect.timeout(policy.requestTimeoutMillis),
    Effect.mapError((cause) => transientRequestError(cause, context)),
    Effect.flatMap((response) =>
      logRateLimitWarning(response, context).pipe(Effect.andThen(handleResponse(response))),
    ),
    Effect.retry(
      Schedule.fromStepWithMetadata<AppError, number, never, Cause.Done<number>, never, never>(
        Effect.succeed((metadata) =>
          isRetryableError(metadata.input) && metadata.attempt < policy.maxAttempts
            ? (() => {
                const delayMillis = retryDelay(
                  policy,
                  retryableErrorHeaders(metadata.input),
                  metadata.attempt,
                  metadata.now,
                );
                return Console.error(
                  retryLogLine(context, metadata.input, delayMillis, metadata.attempt, policy),
                ).pipe(
                  Effect.andThen(
                    Effect.succeed([metadata.attempt, Duration.millis(delayMillis)] as [
                      number,
                      Duration.Duration,
                    ]),
                  ),
                );
              })()
            : Cause.done(metadata.attempt),
        ),
      ),
    ),
  );
