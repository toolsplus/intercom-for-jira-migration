# Intercom for Jira Migration Script

## Prerequisites

Please make sure to complete the following steps in order before running the migration script.

### Jira core data migration
You must have the Jira core data migration completed. This means your Jira Cloud instance should be populated with projects and issues from your DC/Server instance. You may use [the Jira Cloud Migration Assistant (JCMA)](https://support.atlassian.com/migration/docs/use-the-jira-cloud-migration-assistant-to-migrate/) or any other Atlassian-recommended migration method to do so. 

### Backup your Jira data on DC/Server
On your Jira DC/Server instance go to **Cog icon in the top right corner > System > Backup system** and enter a file name for your backup. Retrieve the backup ZIP file and extract the `entities.xml` file from that.

### Create a Jira API token
Go to https://id.atlassian.com/manage-profile/security/api-tokens to create a temporary API token. Make sure that the logged in Jira user has admin rights on the target Jira Cloud instance, or has at least the following permissions:

* Administer Jira global permission or Administer Projects [project permissions](https://confluence.atlassian.com/x/yodKLg)
* Browse projects and Edit issues [project permissions](https://confluence.atlassian.com/x/yodKLg)

We recommend to delete this API token once Intercom for Jira data migration is complete. 

### Install node and npm

Make sure the machine from where you are planning to run the migration scripts have a recent version of node and npm installed: https://docs.npmjs.com/downloading-and-installing-node-js-and-npm

Make sure to keep the `entities.xml` file and the API token handy, you will need them to run the migration script in the next step.

## Usage

Clone the git repository containing the migration scripts:

    git clone https://github.com/toolsplus/intercom-for-jira-migration.git

From within the `intercom-for-jira-migration` folder install the project dependencies by running

    npm install

You are now ready to run the migration script. Prepare the following command to run the script: 

    node intercom-for-jira-migration.mjs \
        -e <sample-backup/entities.xml> \
        -i <https://my-jira-instance.atlassian.net> \
        -u <my-jira-admin-user@my-domain.com> \
        -p <my-atlassian-api-token>

Replace the following values in the command with their actual values:

```
<sample-backup/entities.xml>
    Path to your `entities.xml` file.

<https://my-jira-instance.atlassian.net>
    URL of the Jira Cloud instance you would like to migrate data to.

<my-jira-admin-user@my-domain.com>
    Email address of the Atlassian user account associated with your API token.

<my-atlassian-api-token>
    Atlassian API token created during the prerequisite steps.
```

You can also get run `node intercom-for-jira-migration.mjs -h` for additional help with individual command line arguments.