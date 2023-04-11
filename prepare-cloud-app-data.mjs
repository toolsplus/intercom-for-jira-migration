import z from "zod";
import {doInChunks} from "./common.mjs";

const cloudIssueIdsByIssueKeys = (jiraApiClient) => async (issueKeys) => {
    const responseDataSchema = z.object({
        value: z.array(z.tuple([z.string(), z.number()]))
    });
    const cloudIssueIdByIssueKey = new Map();
    const getCloudIssueIdByIssueKeyChunk = (chunk, chunkInfo) =>
        jiraApiClient
            .post(`/rest/api/3/expression/eval`, {
                expression: "issues.map(i => [i.key, i.id])",
                context: {
                    issues: {
                        jql: {
                            query: `issue IN (${chunk.join(",")})`
                        }
                    }
                }
            })
            .catch((error) => {
                throw new Error(`Failed to fetch issue key to Cloud issue id mapping for chunk ${chunkInfo.index + 1} out of ${chunkInfo.lastIndex + 1}: ${error}`)
            });

    // Defines how many issue keys to convert to Cloud issue ids in a single API request
    const ISSUE_KEY_TO_CLOUD_ISSUE_ID_CHUNK_SIZE = 2000;

    for await (const {response} of doInChunks(issueKeys, ISSUE_KEY_TO_CLOUD_ISSUE_ID_CHUNK_SIZE, getCloudIssueIdByIssueKeyChunk)) {
        const validatedResponseData = responseDataSchema.parse(response.data);
        const cloudIssueIdByIssueKeyChunk = new Map(validatedResponseData.value);
        cloudIssueIdByIssueKeyChunk.forEach((cloudIssueId, issueKey) => cloudIssueIdByIssueKey.set(issueKey, cloudIssueId));
    }
    return cloudIssueIdByIssueKey;
}

const cloudProjectIdsByProjectKeys = (jiraApiClient) => async (projectKeys) => {
    const responseDataSchema = z.object({
        values: z.array(z.object({
            id: z.string(),
            key: z.string()
        }))
    });
    const cloudProjectIdByProjectKey = new Map();

    // https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-projects/#api-rest-api-3-project-search-get
    const getCloudProjectIdByProjectKeyChunk = (chunk, chunkInfo) =>
        jiraApiClient
            .get(`/rest/api/3/project/search?${chunk.map((key) => `keys=${key}`).join('&')}&startAt=${chunkInfo.index * chunkInfo.size}&maxResults=${chunkInfo.size}`)
            .catch((error) => {
                throw new Error(`Failed to fetch project key to Cloud project id mapping for chunk ${chunkInfo.index + 1} out of ${chunkInfo.lastIndex + 1}: ${error}`)
            });

    // Defines how many issue keys to convert to Cloud issue ids in a single API request
    const PROJECT_KEY_TO_CLOUD_PROJECT_ID_CHUNK_SIZE = 50;

    for await (const {
        response
    } of doInChunks(projectKeys, PROJECT_KEY_TO_CLOUD_PROJECT_ID_CHUNK_SIZE, getCloudProjectIdByProjectKeyChunk)) {
        const validatedResponseData = responseDataSchema.parse(response.data);
        const cloudProjectIdByProjectKeyChunk = new Map(validatedResponseData.values.map(({id, key}) => [key, id]));
        cloudProjectIdByProjectKeyChunk.forEach((cloudProjectId, projectKey) => cloudProjectIdByProjectKey.set(projectKey, cloudProjectId));
    }
    return cloudProjectIdByProjectKey;
}

export const prepareCloudAppData = async (mappings, jiraApiClient) => {
    const {
        issueKeyByIssueId,
        projectKeyByProjectId,
        conversationLinksIssuePropertyByIssueId,
        connectionConfigurationProjectPropertyByProjectId
    } = mappings;

    const conversationLinksIssuePropertyByIssueKey = new Map();
    conversationLinksIssuePropertyByIssueId.forEach((_, issueId) => {
        const maybeIssueKey = issueKeyByIssueId.get(issueId);

        if (!maybeIssueKey) {
            throw new Error(`Failed to find issue key mapping for issue id ${issueId}`);
        }

        const maybeConversationLinkPropertyValue = conversationLinksIssuePropertyByIssueId.get(issueId);

        if (!maybeConversationLinkPropertyValue) {
            throw new Error(`Failed to find conversation link property mapping for issue id ${issueId}`);
        }

        conversationLinksIssuePropertyByIssueKey.set(maybeIssueKey, maybeConversationLinkPropertyValue);
    });

    const conversationLinksCloudIssueIdsByIssueKeys = await cloudIssueIdsByIssueKeys(jiraApiClient)([...conversationLinksIssuePropertyByIssueKey.keys()]);

    const conversationLinksIssuePropertyByCloudIssueId = new Map();
    conversationLinksIssuePropertyByIssueKey.forEach((property, issueKey) => {
        const maybeCloudIssueId = conversationLinksCloudIssueIdsByIssueKeys.get(issueKey);

        if (!maybeCloudIssueId) {
            throw new Error(`Failed to find Cloud issue id mapping for issue key ${issueKey}`);
        }

        conversationLinksIssuePropertyByCloudIssueId.set(maybeCloudIssueId, property);
    });

    // Prepare project properties

    const connectionConfigurationProjectPropertyByProjectKey = new Map();
    connectionConfigurationProjectPropertyByProjectId.forEach((_, projectId) => {
        const maybeProjectKey = projectKeyByProjectId.get(projectId);

        if (!maybeProjectKey) {
            throw new Error(`Failed to find project key mapping for project id ${projectId}`);
        }

        const maybeConnectionConfigurationPropertyValue = connectionConfigurationProjectPropertyByProjectId.get(projectId);

        if (!maybeConnectionConfigurationPropertyValue) {
            throw new Error(`Failed to find connection configuration property mapping for project id ${projectId}`);
        }

        connectionConfigurationProjectPropertyByProjectKey.set(maybeProjectKey, maybeConnectionConfigurationPropertyValue);
    });

    const connectionConfigurationCloudProjectIdsByProjectKeys = await cloudProjectIdsByProjectKeys(jiraApiClient)([...connectionConfigurationProjectPropertyByProjectKey.keys()])

    const connectionConfigurationProjectPropertyByCloudProjectId = new Map();
    connectionConfigurationProjectPropertyByProjectKey.forEach((property, projectKey) => {
        const maybeCloudProjectId = connectionConfigurationCloudProjectIdsByProjectKeys.get(projectKey);

        if (!maybeCloudProjectId) {
            throw new Error(`Failed to find Cloud project id mapping for project key ${projectKey}`);
        }

        connectionConfigurationProjectPropertyByCloudProjectId.set(maybeCloudProjectId, property);
    });

    return {
        conversationLinksIssuePropertyByCloudIssueId,
        connectionConfigurationProjectPropertyByCloudProjectId
    };
}
