#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LinearClient } from "@linear/sdk";
// Helper function to slugify strings (can be kept for other potential tools)
const slugify = (text) => {
    return text
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w-]+/g, '')
        .replace(/--+/g, '-');
};
const server = new McpServer({
    name: "LazyDevWorkflowServer",
    version: "0.1.0",
    capabilities: {
        tools: {
            "get-linear-tickets-v1": true,
        },
        resources: {
            "statusCheck": true
        },
        prompts: {
            "start-task": true
        }
    }
});
// Example Resource
server.resource("statusCheck", new ResourceTemplate("status://check", { list: undefined }), async (uri) => ({
    contents: [{
            uri: uri.href,
            text: `Server status: OK, ${new Date().toISOString()}`
        }]
}));
// --- Main Tool ---
server.tool("get-linear-tickets-v1", "Fetches Linear tickets based on a description.", { description: z.string().describe("A description of the feature, bug, or topic to search for in Linear tickets.") }, async ({ description }) => {
    const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
    const linearClient = new LinearClient({ apiKey: LINEAR_API_KEY });
    try {
        console.error(`Fetching Linear tickets for: "${description}" ${LINEAR_API_KEY}`);
        // Using the SDK to fetch issues
        const issues = await linearClient.issues({
            filter: {
                or: [
                    { title: { containsIgnoreCase: description } },
                    { description: { containsIgnoreCase: description } }
                ]
            },
            first: 5 // Limit to 5 results as before
        });
        if (!issues.nodes || issues.nodes.length === 0) {
            console.error("No Linear tickets found.");
            return { content: [{ type: "text", text: `No Linear tickets found for: "${description}"` }] };
        }
        const tickets = issues.nodes;
        const formattedTicketsPromises = tickets.map(async (ticket) => {
            // Fetch related entities
            const state = await ticket.state;
            const assignee = await ticket.assignee;
            const project = await ticket.project;
            return (`Ticket ID: ${ticket.identifier}\n` +
                `Title: ${ticket.title}\n` +
                `Status: ${state?.name || 'N/A'}\n` +
                `Assignee: ${assignee?.name || 'Unassigned'}\n` +
                `Project: ${project?.name || 'N/A'}\n` +
                `URL: ${ticket.url}\n` +
                `Description: ${ticket.description ? ticket.description.substring(0, 200) + '...' : 'No description'}`);
        });
        const formattedTickets = (await Promise.all(formattedTicketsPromises)).join("\n\n---\n\n");
        console.error(`Found ${tickets.length} ticket(s).`);
        return {
            content: [
                { type: "text", text: `Found ${tickets.length} ticket(s) for "${description}":\n\n${formattedTickets}` }
            ]
        };
    }
    catch (error) {
        console.error(`Failed to fetch issues from Linear: ${error.message}`);
        // Check if the error is from the Linear SDK and format appropriately if needed
        let errorMessage = error.message;
        if (error.errors && Array.isArray(error.errors)) { // LinearSDK might return errors in an array
            errorMessage = error.errors.map((e) => e.message).join(', ');
        }
        return {
            content: [{ type: "text", text: `Failed to fetch issues from Linear: ${errorMessage}` }]
        };
    }
});
// --- New Prompt for Starting a Task Workflow ---
server.prompt("start-task", "Starts a new development task: fetches Linear tickets and creates a git branch.", {
    taskDescription: z.string().describe("A description of the feature or bug."),
    branchType: z.enum(["feature", "bugfix"]).describe("The type of branch to create (feature or bugfix).")
}, async ({ taskDescription, branchType }) => {
    const message = `Start this task.
    Task Description: ${taskDescription}
    STRICT Steps to follow:
    1. Fetch the linear tickets for the task, use the tool "get-linear-tickets-v1" to fetch the tickets.
    2. Let the user pick the ticket, explcityly ask they want to work on.
    3. IMPORTANT: Create a new branch for the task.
    4. Start the task.
    `;
    return {
        messages: [{
                role: "user",
                content: { type: "text", text: message }
            }]
    };
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("LazyDevWorkflowServer for Linear Tickets running on stdio.", process.env.LINEAR_API_KEY);
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
