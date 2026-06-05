import { Schema, SchemaGetter, SchemaTransformation } from "effect";

const ConversationId = Schema.String.pipe(
  Schema.decode(SchemaTransformation.trim()),
  Schema.check(Schema.isNonEmpty()),
);
const ConversationIds = Schema.ReadonlySet(ConversationId);
const ConversationIdsFromArray = Schema.Array(ConversationId).pipe(
  Schema.decodeTo(ConversationIds, {
    decode: SchemaGetter.transform((conversationIds) => new Set(conversationIds)),
    encode: SchemaGetter.transform((conversationIds) => [...conversationIds]),
  }),
);

/**
 * Current Jira issue property value used by the app to store linked Intercom conversations.
 */
export const ConversationLinkPropertyValue = Schema.Struct({
  count: Schema.Number,
  conversationIds: ConversationIds,
});

/**
 * Normalized migration representation of linked Intercom conversations.
 *
 * Jira stores conversation IDs as an array in JSON, while application code works with a readonly
 * set to deduplicate IDs during export and import.
 */
export const ConversationLinkMigrationValue = Schema.Struct({
  conversationIds: ConversationIdsFromArray,
});

export type ConversationLinkMigrationValue = Schema.Schema.Type<
  typeof ConversationLinkMigrationValue
>;

/**
 * Legacy Jira issue property value where linked conversations were stored as objects with IDs.
 *
 * Decoding this schema returns the normalized migration representation so old exports can be
 * processed alongside the current property format.
 */
export const LegacyConversationLinkPropertyValue = Schema.Array(
  Schema.Struct({
    id: Schema.String,
  }),
).pipe(
  Schema.decodeTo(ConversationLinkMigrationValue, {
    decode: SchemaGetter.transform((links) => ({
      conversationIds: links.map((link) => link.id),
    })),
    encode: SchemaGetter.transform((value) => [...value.conversationIds].map((id) => ({ id }))),
  }),
);
