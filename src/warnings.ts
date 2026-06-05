export type WarningCode =
  | "APPROXIMATE_COUNT_FAILED"
  | "CONFIGURATION_MALFORMED"
  | "DEFAULT_SCOPE_DISCOVERY_FAILED"
  | "EMPTY_EXPLICIT_SPACE"
  | "EMPTY_LINK_PROPERTY"
  | "LINK_PROPERTY_MALFORMED";

interface ExportWarning {
  readonly code: WarningCode;
  readonly context: Record<string, string | number | boolean | null>;
}

interface WarningSummary {
  readonly count: number;
  readonly truncated: boolean;
  readonly warnings: readonly ExportWarning[];
}

export class WarningCollector {
  readonly #captured: ExportWarning[] = [];
  #count = 0;

  constructor(readonly limit = 100) {}

  add(code: WarningCode, context: ExportWarning["context"] = {}): ExportWarning {
    const warning = { code, context };
    this.#count += 1;
    if (this.#captured.length < this.limit) {
      this.#captured.push(warning);
    }
    return warning;
  }

  summary(): WarningSummary {
    return {
      count: this.#count,
      truncated: this.#count > this.#captured.length,
      warnings: [...this.#captured],
    };
  }
}

export const formatWarning = (warning: ExportWarning): string =>
  `[warning:${warning.code}] ${JSON.stringify(warning.context)}`;
