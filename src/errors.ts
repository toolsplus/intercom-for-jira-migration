import { Data } from "effect";

type AppErrorCode =
  | "artifact.blankLine"
  | "artifact.invalidExtension"
  | "artifact.invalidGzip"
  | "artifact.invalidJson"
  | "artifact.invalidRecord"
  | "artifact.manifestMissing"
  | "artifact.manifestMisplaced"
  | "config.missing"
  | "export.emptyDefaultScope"
  | "export.emptyExplicitScope"
  | "export.invalidOutput"
  | "export.malformedLinkProperty"
  | "export.outputExists"
  | "export.outputParentMissing"
  | "import.bulkTaskFailed"
  | "jira.auth"
  | "jira.malformed"
  | "jira.permission"
  | "jira.request"
  | "jira.transient"
  | "links.malformed";

interface AppErrorOptions {
  readonly context?: Record<string, unknown>;
  readonly exitCode?: number;
  readonly cause?: unknown;
}

export class AppError extends Data.TaggedError("AppError")<{
  readonly code: AppErrorCode;
  readonly message: string;
  readonly context: Record<string, unknown>;
  readonly exitCode: number;
  readonly cause?: unknown;
}> {
  constructor(code: AppErrorCode, message: string, options: AppErrorOptions = {}) {
    super({
      code,
      message,
      context: options.context ?? {},
      exitCode: options.exitCode ?? 1,
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
  }
}

export const errorMessage = (error: unknown): string => {
  if (error instanceof AppError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

export const errorDetails = (error: unknown): Record<string, unknown> => {
  if (error instanceof AppError) {
    return error.context;
  }
  return {};
};
