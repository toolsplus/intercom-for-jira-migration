import z from "zod";
import he from "he";
import {doInChunks} from "./common.mjs";

const APP_KEY = 'io.toolsplus.atlassian.connect.jira.intercom';

const taskProgressSchema = z.object({
    self: z.string(),
    id: z.string(),
    status: z.union([
        z.literal("ENQUEUED"),
        z.literal("RUNNING"),
        z.literal("COMPLETE"),
        z.literal("FAILED"),
        z.literal("CANCEL_REQUESTED"),
        z.literal("CANCELLED"),
        z.literal("DEAD")
    ]),
    progress: z.number(),
    message: z.string().optional()
});

const checkTaskStatus = (jiraApiClient) => async (taskId) => {
    const response = await jiraApiClient
        .get(`/rest/api/3/task/${taskId}`)
        .catch((error) => {
            throw new Error(`Failed to check status of task with id ${taskId}: ${error}`);
        });
    return taskProgressSchema.parse(response.data);
}

export const importConversationLinkIssueProperties = async (conversationLinksIssuePropertyByCloudIssueId, jiraApiClient) => {
    const conversationLinksIssuePropertySchema = z.object({
        conversationIds: z.array(z.string())
    });

    const conversationLinksIssuePropertyUpdate = [...conversationLinksIssuePropertyByCloudIssueId.entries()].map(([cloudIssueId, encodedPropertyText]) => {
        const propertyJson = JSON.parse(he.decode(encodedPropertyText));
        const validatedProperty = conversationLinksIssuePropertySchema.parse(propertyJson);
        const linkCount = validatedProperty.conversationIds.length;
        return {
            issueID: cloudIssueId,
            properties: {
                ['intercom.conversation.links']: {
                    count: linkCount,
                    conversationIds: validatedProperty.conversationIds
                },
                [`com.atlassian.jira.issue:${APP_KEY}:issue-glance-intercom-conversation-links:status`]: {
                    type: 'badge',
                    value: {
                        label: `${linkCount}`
                    }
                }
            }
        }
    });

    const importIssuePropertiesChunk = (jiraApiClient) => (c) => jiraApiClient.post(`/rest/api/3/issue/properties/multi`, {
        issues: c
    });

    // https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-properties/#api-rest-api-3-issue-properties-multi-post
    const MAX_BULK_SET_ISSUE_PROPERTIES_CHUNK_SIZE = 100;
    for await (const {response, chunkInfo} of doInChunks(conversationLinksIssuePropertyUpdate, MAX_BULK_SET_ISSUE_PROPERTIES_CHUNK_SIZE, importIssuePropertiesChunk(jiraApiClient))) {
        const initialTaskProgress = taskProgressSchema.parse(response.data);

        const confirmTaskCompletion = async (taskProgressCheck) => {
            const taskProgress = await taskProgressCheck;
            switch (taskProgress.status) {
                case "COMPLETE":
                    console.info(`    Importing issue property chunk ${chunkInfo.index+1}/${chunkInfo.lastIndex+1} complete (${taskProgress.progress}%)`);
                    return; // continue with next batch
                case "RUNNING":
                case "ENQUEUED":
                    console.info(`    Importing issue property chunk ${chunkInfo.index+1}/${chunkInfo.lastIndex+1} (${taskProgress.progress}%)...`);
                    // Wait 2 seconds then check the status again
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                    await confirmTaskCompletion(checkTaskStatus(jiraApiClient)(taskProgress.id));
                    return;
                case "DEAD":
                case "FAILED":
                case "CANCELLED":
                case "CANCEL_REQUESTED":
                    throw new Error(`Failed to import issue property chunk ${chunkInfo.index+1}: Task status ${taskProgressCheck.status}, progress ${taskProgressCheck.progress}%, message: ${taskProgressCheck.message ?? '-'}`);
            }
        };

        await confirmTaskCompletion(Promise.resolve(initialTaskProgress));
    }
}
