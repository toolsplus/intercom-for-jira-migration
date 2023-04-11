import axios from 'axios';
import axiosRetry from "axios-retry";
import {extractAppDataFromBackup} from "./extract-app-data.mjs";
import {prepareCloudAppData} from "./prepare-cloud-app-data.mjs";
import {importConversationLinkIssueProperties} from "./import-issue-properties.mjs";
import {importConnectionConfigurationProjectProperties} from "./import-project-properties.mjs";


export const doMigration = async (options) => {
    const jiraApiClient = axios.create({
        baseURL: options.instance, auth: {
            username: options.user, password: options.password
        }
    });
    axiosRetry(jiraApiClient, {
        retries: 3,
        retryDelay: axiosRetry.exponentialDelay,
        onRetry: (retryCount, error, requestConfig) => {
            console.info(`Request to ${requestConfig.url} failed with status ${error.response?.status}: Retrying...`);
        }
    });

    console.info(`> Importing Intercom for Jira data from ${options.entitiesXmlFile} to ${options.instance}...`);

    console.info(">> Reading app data from backup file...");
    const appDataServerMappings = await extractAppDataFromBackup(options.entitiesXmlFile);
    console.info("<< Successfully read app data from backup file");

    console.info(">> Preparing app data for import...");
    const {
        conversationLinksIssuePropertyByCloudIssueId, connectionConfigurationProjectPropertyByCloudProjectId
    } = await prepareCloudAppData(appDataServerMappings, jiraApiClient);
    console.info("<< Successfully prepared app data for import");

    console.info(">> Importing app data into Jira...");

    console.info(`>>> Importing ${conversationLinksIssuePropertyByCloudIssueId.size} conversation link issue properties...`);
    await importConversationLinkIssueProperties(conversationLinksIssuePropertyByCloudIssueId, jiraApiClient);
    console.info(`<<< Successfully imported ${conversationLinksIssuePropertyByCloudIssueId.size} conversation link issue properties`);

    console.info(`>>> Importing ${connectionConfigurationProjectPropertyByCloudProjectId.size} connection configuration properties...`);
    await importConnectionConfigurationProjectProperties(connectionConfigurationProjectPropertyByCloudProjectId, jiraApiClient);
    console.info(`<<< Successfully imported ${connectionConfigurationProjectPropertyByCloudProjectId.size} connection configuration properties`);


    console.info("<< Successfully imported app data into Jira");

    console.info("< Intercom for Jira data import is complete");
}

