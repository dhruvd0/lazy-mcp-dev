#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
// import { execSync } from 'child_process'; // No longer needed for this simplified tool
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// Helper function to slugify strings (can be kept for other potential tools)
const slugify = (text: string) => {
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
        "get-linear-tickets": true,
    },
    resources: {
        "statusCheck": true
    },
    prompts: {
        "generateCommitMessage": true
    }
  }
});

// Example Resource
server.resource(
  "statusCheck",
  new ResourceTemplate("status://check", { list: undefined }),
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: `Server status: OK, ${new Date().toISOString()}`
    }]
  })
);

// --- Main Tool ---
server.tool(
  "get-linear-tickets",
  "Fetches Linear tickets based on a description.",
  { description: z.string().describe("A description of the feature, bug, or topic to search for in Linear tickets.") },
  async ({ description }) => {
    const LINEAR_API_KEY = "lin_api_xEVXTPuDQcdTR2TJSO9MEABvTYHexuwpw6QCb4n9";
    if (!LINEAR_API_KEY) {
      return {
        content: [{ type: "text", text: "LINEAR_API_KEY environment variable is not set." }]
      };
    }

    const linearQuery = `
      query Issues($filter: IssueFilter, $first: Int) {
        issues(filter: $filter, first: $first) {
          nodes {
            id
            title
            identifier
            description
            state { name }
            assignee { name }
            project { name }
            url
          }
        }
      }
    `;
    const linearVariables = {
      filter: {
        or: [
          { title: { containsIgnoreCase: description } },
          { description: { containsIgnoreCase: description } }
        ]
      },
      first: 5
    };

    try {
      console.error(`Fetching Linear tickets for: "${description}"`);
      const response = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": LINEAR_API_KEY,
        },
        body: JSON.stringify({ query: linearQuery, variables: linearVariables }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Linear API Error: ${response.status} ${response.statusText} - ${errorText}`);
        return {
          content: [{ type: "text", text: `Error fetching from Linear API: ${response.status} ${response.statusText} - ${errorText}` }]
        };
      }

      const data = await response.json();
      if (data.errors) {
        console.error(`Linear API GraphQL Error: ${JSON.stringify(data.errors)}`);
        return {
          content: [{ type: "text", text: `Linear API GraphQL Error: ${JSON.stringify(data.errors)}` }]
        };
      }

      if (!data.data.issues.nodes || data.data.issues.nodes.length === 0) {
        console.error("No Linear tickets found.");
        return { content: [{ type: "text", text: `No Linear tickets found for: "${description}"` }] };
      }

      const tickets = data.data.issues.nodes;
      const formattedTickets = tickets.map((ticket: any) => (
        `Ticket ID: ${ticket.identifier}\n` +
        `Title: ${ticket.title}\n` +
        `Status: ${ticket.state?.name || 'N/A'}\n` +
        `Assignee: ${ticket.assignee?.name || 'Unassigned'}\n` +
        `Project: ${ticket.project?.name || 'N/A'}\n` +
        `URL: ${ticket.url}\n` +
        `Description: ${ticket.description ? ticket.description.substring(0, 200) + '...' : 'No description'}`
      )).join("\n\n---\n\n");

      console.error(`Found ${tickets.length} ticket(s).`);
      return {
        content: [
          { type: "text", text: `Found ${tickets.length} ticket(s) for "${description}":\n\n${formattedTickets}` }
        ]
      };

    } catch (error: any) {
      console.error(`Failed to fetch issues from Linear: ${error.message}`);
      return {
        content: [{ type: "text", text: `Failed to fetch issues from Linear: ${error.message}` }]
      };
    }
  }
);

// Example Prompt
server.prompt(
  "generateCommitMessage",
  "Generates a commit message based on a task description.",
  { taskDescription: z.string().describe("A description of the task or changes made.") },
  ({ taskDescription }) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Based on the task: "${taskDescription}", please suggest a concise and informative commit message following conventional commit standards.`
      }
    }]
  })
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("LazyDevWorkflowServer for Linear Tickets running on stdio.");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});