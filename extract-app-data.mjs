import fs from "fs";
import readline from "readline";

const REGEX_CONVERSATION_LINKS_ISSUE_PROPERTY = /<EntityProperty id="[0-9]+" entityName="IssueProperty" entityId="([0-9]+)" propertyKey="intercom.conversation.links" created="[0-9-\s:.]+" updated="[0-9-\s:.]+" value="(.*?)"\/>/;
const REGEX_CONNECTION_CONFIGURATION_PROJECT_PROPERTY = /<EntityProperty id="[0-9]+" entityName="ProjectProperty" entityId="([0-9]+)" propertyKey="intercom.connection.configuration" created="[0-9-\s:.]+" updated="[0-9-\s:.]+" value="(.*?)"\/>/;
const REGEX_ISSUE_ID_TO_KEY = /<Issue id="([0-9]+)" key="([a-zA-Z0-9-]+)" number="/;
const REGEX_PROJECT_ID_TO_KEY = /<Project id="([0-9]+)".+key="([a-zA-Z0-9-]+)"/;

const extractIssueIdToKeyMapping = (line) => {
    const match = REGEX_ISSUE_ID_TO_KEY.exec(line);
    if (match === null) {
        return null;
    } else {
        const [_, id, key] = match;
        return {
            issueId: id,
            issueKey: key
        }
    }
}

const extractProjectIdToKeyMapping = (line) => {
    const match = REGEX_PROJECT_ID_TO_KEY.exec(line);
    if (match === null) {
        return null;
    } else {
        const [_, id, key] = match;
        return {
            projectId: id,
            projectKey: key
        }
    }
}

const extractIntercomConversationLinksIssueProperty = (line) => {
    const match = REGEX_CONVERSATION_LINKS_ISSUE_PROPERTY.exec(line);
    if (match === null) {
        return null;
    } else {
        const [_, issueId, value] = match;
        return {
            issueId,
            property: value
        }
    }
}

const extractConnectionConfigurationProjectProperty = (line) => {
    const match = REGEX_CONNECTION_CONFIGURATION_PROJECT_PROPERTY.exec(line);
    if (match === null) {
        return null;
    } else {
        const [_, projectId, value] = match;
        return {
            projectId,
            property: value
        }
    }
}

export const extractAppDataFromBackup = async (entitiesXmlFile) => {
    const fileStream = fs.createReadStream(entitiesXmlFile);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
    });

    const issueKeyByIssueId = new Map();
    const projectKeyByProjectId = new Map();
    const conversationLinksIssuePropertyByIssueId = new Map();
    const connectionConfigurationProjectPropertyByProjectId = new Map();

    let lineNo = 0;
    for await (const line of rl) {
        lineNo++;
        if (REGEX_ISSUE_ID_TO_KEY.test(line)) {
            const maybeIssueIdToKeyMapping = extractIssueIdToKeyMapping(line);
            if (!maybeIssueIdToKeyMapping) {
                throw new Error(`Expected issue id to key mapping in line ${lineNo} but regex did not return a match`);
            }
            if (issueKeyByIssueId.has(maybeIssueIdToKeyMapping.issueId)) {
                throw new Error(`Expected issue id to key mapping in line ${lineNo} but mapping for issue id ${maybeIssueIdToKeyMapping.issueId} already exists`);
            }

            issueKeyByIssueId.set(maybeIssueIdToKeyMapping.issueId, maybeIssueIdToKeyMapping.issueKey);
        }

        if (REGEX_PROJECT_ID_TO_KEY.test(line)) {
            const maybeProjectIdToKeyMapping = extractProjectIdToKeyMapping(line);
            if (!maybeProjectIdToKeyMapping) {
                throw new Error(`Expected project id to key mapping in line ${lineNo} but regex did not return a match`);
            }
            if (projectKeyByProjectId.has(maybeProjectIdToKeyMapping.projectId)) {
                throw new Error(`Expected project id to key mapping in line ${lineNo} but mapping for project id ${maybeProjectIdToKeyMapping.projectId} already exists`);
            }

            projectKeyByProjectId.set(maybeProjectIdToKeyMapping.projectId, maybeProjectIdToKeyMapping.projectKey);
        }

        if (REGEX_CONVERSATION_LINKS_ISSUE_PROPERTY.test(line)) {
            const maybeIssueIdToConversationLinkPropertyMapping = extractIntercomConversationLinksIssueProperty(line);
            if (!maybeIssueIdToConversationLinkPropertyMapping) {
                throw new Error(`Expected issue id to conversation link issue property mapping in line ${lineNo} but regex did not return a match`);
            }

            if (conversationLinksIssuePropertyByIssueId.has(maybeIssueIdToConversationLinkPropertyMapping.issueId)) {
                throw new Error(`Expected issue id to conversation link issue property mapping in line ${lineNo} but mapping for issue id ${maybeIssueIdToConversationLinkPropertyMapping.issueId} already exists`);
            }

            conversationLinksIssuePropertyByIssueId.set(maybeIssueIdToConversationLinkPropertyMapping.issueId, maybeIssueIdToConversationLinkPropertyMapping.property);
        }

        if (REGEX_CONNECTION_CONFIGURATION_PROJECT_PROPERTY.test(line)) {
            const maybeProjectIdToConnectionConfigurationPropertyMapping = extractConnectionConfigurationProjectProperty(line);
            if (!maybeProjectIdToConnectionConfigurationPropertyMapping) {
                throw new Error(`Expected project id to connection configuration project property mapping in line ${lineNo} but regex did not return a match`);
            }

            if (connectionConfigurationProjectPropertyByProjectId.has(maybeProjectIdToConnectionConfigurationPropertyMapping.projectId)) {
                throw new Error(`Expected project id to connection configuration project property mapping in line ${lineNo} but mapping for project id ${maybeProjectIdToConnectionConfigurationPropertyMapping.projectId} already exists`);
            }

            connectionConfigurationProjectPropertyByProjectId.set(maybeProjectIdToConnectionConfigurationPropertyMapping.projectId, maybeProjectIdToConnectionConfigurationPropertyMapping.property);
        }
    }

    console.info("=== App data ===");
    console.info(( `    Found ${issueKeyByIssueId.size} issue mappings`));
    console.info(( `    Found ${projectKeyByProjectId.size} project mappings`));
    console.info(( `    Found ${conversationLinksIssuePropertyByIssueId.size} issue properties to import`));
    console.info(( `    Found ${connectionConfigurationProjectPropertyByProjectId.size} project properties to import`));
    console.info("================");

    return {
        issueKeyByIssueId,
        projectKeyByProjectId,
        conversationLinksIssuePropertyByIssueId,
        connectionConfigurationProjectPropertyByProjectId
    };
}