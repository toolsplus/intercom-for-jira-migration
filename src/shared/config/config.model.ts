import { Schema, SchemaGetter } from "effect";

export const TrimmedNonEmptyString = Schema.Trim.pipe(Schema.decodeTo(Schema.NonEmptyString));

const canonicalizeJiraCloudSourceUrl = (url: URL): string => `${url.protocol}//${url.hostname}`;

export const JiraCloudSource: Schema.Codec<string, string> = Schema.Trim.pipe(
  Schema.decodeTo(Schema.URLFromString),
)
  .check(
    Schema.makeFilter((url) => url.protocol === "https:" || "Source must use HTTPS."),
    Schema.makeFilter(
      (url) =>
        url.hostname.endsWith(".atlassian.net") ||
        "Source host must be a Jira Cloud atlassian.net site.",
    ),
  )
  .pipe(
    Schema.decodeTo(Schema.String, {
      decode: SchemaGetter.transform(canonicalizeJiraCloudSourceUrl),
      encode: SchemaGetter.transform((source: string) => new URL(source)),
    }),
  );

export const RedactedNonEmptyString = Schema.Redacted(TrimmedNonEmptyString);

export const normalizeSpaceList = (values: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  for (const value of values) {
    for (const piece of value.split(",")) {
      const space = piece.trim();
      if (space.length > 0) {
        seen.add(space.toUpperCase());
      }
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
};
