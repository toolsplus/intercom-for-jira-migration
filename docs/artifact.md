# Artifact Contract

The CLI-owned artifact is compressed UTF-8 JSON Lines. Every line is compact
single-line JSON, and blank lines are invalid.

The first record is required:

```json
{
  "type": "manifest",
  "createdAt": "2026-06-05T00:00:00.000Z",
  "source": "https://example.atlassian.net"
}
```

Data records:

```json
{"type":"spaceConfiguration","spaceKey":"ENG","configuration":{"enabled":true}}
{"type":"workItemConversationLinks","spaceKey":"ENG","workItemKey":"ENG-1","conversationIds":["abc","def"]}
```

Invariants:

- Record types are `manifest`, `spaceConfiguration`, and `workItemConversationLinks`.
- The manifest contains only `type`, `createdAt`, and `source`.
- Records never include Jira numeric space IDs or work-item IDs.
- `configuration` is opaque JSON.
- `conversationIds` are opaque strings, deduplicated in first-seen order during export.
- The writer validates every record before writing.
- The reader validates every record while reading.
- Future import code should consume this shared reader and apply records through idempotent upserts.
