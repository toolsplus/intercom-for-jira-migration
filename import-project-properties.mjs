import z from "zod";
import he from "he";
import update from 'immutability-helper';

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

export const importConnectionConfigurationProjectProperties = async (connectionConfigurationProjectPropertyByCloudProjectId, jiraApiClient) => {
    const connectionConfigurationPropertySchema = z.object({
        intercomIssuePanel: z.object({
            enabled: z.boolean(),
            visibleFields: z.object({
                user: z.array(z.string()),
                lead: z.array(z.string()),
                company: z.array(z.string())
            })
        }),
        conversationLinking: z.object({
            enabled: z.boolean(),
            notificationTriggers: z.object({
                issueAssignmentChanged: z.object({
                    name: z.literal('issueAssignmentChanged'),
                    enabled: z.boolean(),
                    reopenConversations: z.boolean()
                }),
                issueCommented: z.object({
                    name: z.literal('issueCommented'),
                    enabled: z.boolean(),
                    reopenConversations: z.boolean(),
                    filterEnabled: z.boolean()
                }),
                issueTransitioned: z.object({
                    name: z.literal('issueTransitioned'),
                    enabled: z.boolean(),
                    reopenConversations: z.boolean()
                })
            })
        })
    });

    const defaultCloudConnectionConfiguration = {
        intercomIssuePanel: {
            enabled: true,
            allowConversationView: true,
            visibleFields: {
                user: [
                    "email",
                    "phone",
                    "user_id",
                    "created_at",
                    "last_request_at",
                    "session_count"
                ],
                lead: [
                    "email",
                    "phone",
                    "user_id",
                    "created_at",
                    "last_request_at",
                    "session_count"
                ],
                company: [
                    "size", "website"
                ]
            }
        },
        conversationLinking: {
            enabled: true,
            unassignOnOpen: false,
            notificationTriggers: {
                issueAssignmentChanged: {
                    name: "issueAssignmentChanged",
                    enabled: true,
                    reopenConversations: false
                },
                issueCommented: {
                    name: "issueCommented",
                    enabled: true,
                    reopenConversations: false,
                    filterEnabled: false
                },
                issueTransitioned: {
                    name: "issueTransitioned",
                    enabled: true,
                    reopenConversations: false
                }
            }
        }
    }

    const connectionConfigurationProjectProperties = [...connectionConfigurationProjectPropertyByCloudProjectId.entries()].map(([cloudProjectId, encodedPropertyText]) => {
        const propertyJson = JSON.parse(he.decode(encodedPropertyText));
        const validatedProperty = connectionConfigurationPropertySchema.parse(propertyJson);
        return {
            cloudProjectId,
            property: update(validatedProperty, {
                intercomIssuePanel: {
                    allowConversationView: {
                        $set: defaultCloudConnectionConfiguration
                            .intercomIssuePanel
                            .allowConversationView
                    }
                },
                conversationLinking: {
                    unassignOnOpen: {$set: defaultCloudConnectionConfiguration.conversationLinking.unassignOnOpen}
                },
                _version: {$set: 0}
            })
        }
    });

    // https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-project-properties/#api-rest-api-3-project-projectidorkey-properties-propertykey-put
    const importConnectionConfigurationProperty = (jiraApiClient) => ({
                                                                          cloudProjectId,
                                                                          property
                                                                      }) =>
        jiraApiClient
            .put(`/rest/api/3/project/${cloudProjectId}/properties/intercom.connection.configuration`, property)
            .catch((error) => {
                throw new Error(`Failed to import connection configuration project property for project ${cloudProjectId}: ${error}`);
            });

    for (const property of connectionConfigurationProjectProperties) {
        await importConnectionConfigurationProperty(jiraApiClient)(property)
    }
}
