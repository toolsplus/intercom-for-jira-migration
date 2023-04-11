import {program, InvalidArgumentError} from "commander";
import z from 'zod';
import {doMigration} from "./migration.mjs";

const validateOption = (validator) => (value) => {
    try {
        return validator.parse(value);
    } catch (error) {
        throw new InvalidArgumentError(error.message);
    }
}

program
    .name('intercom-for-jira-migration')
    .description('Imports Intercom for Jira data to a Cloud instance from a given DC/Server backup')
    .requiredOption('-i, --instance <url>', 'instance must be the Jira Cloud instance URL (https://???.atlassian.net) you would like to migrate data to', validateOption(z.string().regex(/^https:\/\/[\w\d-]+\.atlassian\.net$/)))
    .requiredOption('-u, --user <email>', 'user must be a valid Atlassian admin user email address', validateOption(z.string().email()))
    .requiredOption('-p, --password <api-token>', 'password must be a valid Atlassian API token for the admin user (https://id.atlassian.com/manage-profile/security/api-tokens)')
    .requiredOption('-e, --entitiesXmlFile <entities-xml-file>', 'location of the entities.xml file from your DC/Server backup, e.g. my-backup/entities.xml', validateOption(z.string().regex(/^.*entities.xml$/)))

program.parse();

doMigration(program.opts());