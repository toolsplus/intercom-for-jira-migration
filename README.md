# Intercom for Jira Migration CLI

`ifj` is a command line utility to support Cloud-to-Cloud migrations for Intercom for Jira Cloud (ifj). It exports Intercom for Jira Cloud data from a source Jira Cloud site and then imports it into a target site.

## Requirements

- **Node.js:** Node.js 24 is recommended. Install it from the
  [official Node.js download page](https://nodejs.org/en/download).
- **pnpm:** This repository uses pnpm to install dependencies and run scripts.
  Install it by following the [pnpm installation guide](https://pnpm.io/installation).

### Source Jira site

- **Administrator user:** This user should have access to all Jira spaces on the source site.
- **Jira API token:** Follow the [Atlassian documentation on how to create a scoped Jira API token](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/#Create-an-API-token-with-scopes) for the administrator user. Include the following Classic scopes:
  - `read:jira-work`

### Target Jira site

- **Administrator user:** This user should have access to all Jira spaces on the target site.
- **Jira API token:** Follow the [Atlassian documentation on how to create a scoped Jira API token](https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/#Create-an-API-token-with-scopes) for the administrator user. Include the following Classic scopes:
  - `read:jira-work`
  - `write:jira-work`

If the user has access to both the source and target sites, you can include both source and target scopes in the same API token and use the same token for both import and export.

## Getting started

To run the CLI from a local clone, follow these steps:

```sh
git clone <repository-url>
cd intercom-for-jira-migration
pnpm install
pnpm build
```

After building, run the CLI with Node from the generated `dist` output:

```sh
node dist/src/ifj.js export --source https://example.atlassian.net --user admin-source@example.com --api-token "$TOKEN_SOURCE"
node dist/src/ifj.js inspect intercom-for-jira-export.jsonl.gz
node dist/src/ifj.js import intercom-for-jira-export.jsonl.gz --target https://target.atlassian.net --user admin-target@example.com --api-token "$TOKEN_TARGET"
```

You may use environment variables or a .env file to set command configurations. Refer to the command documentation below for available options.

## Commands

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

### Import

`ifj import <artifact>` authenticates with a target Jira Cloud site, verifies
Jira global admin permission, validates the full compressed JSON Lines artifact,
and imports selected Jira spaces sequentially.

By default, import applies every space represented in the artifact. Pass
`--space` one or more times to import only selected spaces. Space keys are
trimmed, uppercased, deduplicated, and sorted. Selected spaces that are absent
from the artifact or unavailable on the target site are reported as skipped while
the import continues for other spaces.

Space configuration properties are written before work-item conversation links
for each space. Work-item keys from the artifact are resolved to target Jira
issue IDs at write time and submitted through Jira issue-property bulk tasks in
batches of up to 100. Empty conversation ID arrays are valid and overwrite the
target property with no linked conversations.

When an import completes, remember to reconnect imported Jira spaces to Intercom by following
the setup guide: https://toolspl.us/intercom-for-jira-cloud-setup-connection

Flags:

- `--target URL`: target Jira Cloud URL
- `--user EMAIL`: Atlassian account email
- `--api-token TOKEN`: Atlassian API token
- `--space KEY`: optional target space key. Repeat to select multiple spaces
- `--json`: print the final summary as JSON

Environment variables:

- `IMPORT_TARGET`
- `IMPORT_USER`
- `IMPORT_API_TOKEN`
- `IMPORT_ARTIFACT_PATH`
- `IMPORT_SPACES`: comma-separated space keys.

### Inspect

`ifj inspect <artifact>` validates a `.jsonl.gz` artifact and prints aggregate
counts:

```sh
ifj inspect migration.jsonl.gz
ifj inspect migration.jsonl.gz --json
```

The artifact path can also be supplied with `INSPECT_ARTIFACT_PATH`.

## Configuration

Configuration precedence is flags, then process environment, then `.env` from
the current working directory, then defaults.
