# Intercom for Jira Migration CLI

`ifj` is a command line utility to support Cloud-to-Cloud migrations for Intercom for Jira Cloud (ifj). It exports Intercom for Jira Cloud data from a source Jira Cloud site and then imports it into a target site.

## Requirements

### Source Jira site

- **Administrator user:** This user should have access to all Jira spaces on the source site.
- **Jira API token:** Follow the [Atlassian documentation on how to create a scoped Jira API token](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/#Create-an-API-token-with-scopes) for the administrator user. Include the following Classic scopes:
  - `read:jira-work`

### Target Jira site

- **Administrator user:** This user should have access to all Jira spaces on the target site.
- **Jira API token:** Follow the [Atlassian documentation on how to create a scoped Jira API token](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/#Create-an-API-token-with-scopes) for the administrator user. Including the following Classic scope:
  - `write:jira-work`

If the user has access to both the source and target sites, you can include both source and target scopes in the same API token and use the same token for both import and export.

## Commands

```sh
ifj export --source https://example.atlassian.net --user admin@example.com --api-token "$TOKEN"
ifj inspect intercom-for-jira-export.jsonl.gz
```

### Export

`ifj export` authenticates with Jira Cloud basic auth using an Atlassian account
email and API token. It verifies that the user associated with the API token has Jira global admin permission before exporting.

By default, export discovers spaces that are currently connected to Intercom. If
none are found, export fails with a "nothing to export" message; pass
`--space` to select spaces explicitly. Explicit spaces are validated for
existence and may be exported even when no Intercom configuration exists.

Flags:

- `--source URL`: source Jira Cloud URL
- `--user EMAIL`: Atlassian account email
- `--api-token TOKEN`: Atlassian API token
- `--out PATH`: optional output file path. Must end with `.jsonl.gz`.
  Defaults to `intercom-for-jira-export.jsonl.gz` in the current working directory.
  If the file exists the app will pick a unique name, e.g., `intercom-for-jira-export1.jsonl.gz`.
- `--space KEY`: optional space key. Repeat to select multiple spaces
- `--json`: print the final summary as JSON

Environment variables:

- `EXPORT_SOURCE`
- `EXPORT_USER`
- `EXPORT_API_TOKEN`
- `EXPORT_OUT`
- `EXPORT_SPACES`: comma-separated space keys.

Exports are written as compressed JSON Lines files with the `.jsonl.gz`
extension.

### Inspect

`ifj inspect <artifact>` validates a `.jsonl.gz` artifact and prints aggregate
counts:

```sh
ifj inspect migration.jsonl.gz
ifj inspect migration.jsonl.gz --json
```

## Configuration

Configuration precedence is flags, then process environment, then `.env` from
the current working directory, then defaults.
