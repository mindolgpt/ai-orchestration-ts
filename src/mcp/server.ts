import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createInbox } from "@/mcp/inbox";
import { ObsidianVault } from "@/knowledge/vault";
import { createEmbedder } from "@/knowledge/embedder";
import { SemanticSearch } from "@/knowledge/search";
import { DeepInterviewPlanner } from "@/orchestrator/planner";
import { BranchHunt } from "@/orchestrator/branch-hunt";
import { registerSessionTools, registerKnowledgeTools, registerDagTools, registerBranchTools, registerWikiTools, ChildSession } from "@/mcp/tools";

export class MCPServer {
  private server: McpServer;
  private inbox = createInbox();
  private vault = new ObsidianVault(process.env.OBSIDIAN_VAULT_PATH || "./vault");
  private search: SemanticSearch;
  private sessions = new Map<string, ChildSession>();
  private dagResults = new Map<string, unknown>();
  private planner = new DeepInterviewPlanner();
  private branchHunt: BranchHunt;
  private maxSessions: number;

  constructor(maxSessions = 5) {
    this.maxSessions = maxSessions;
    const embedder = createEmbedder();
    this.search = new SemanticSearch(embedder);
    this.branchHunt = new BranchHunt(this.inbox);

    this.server = new McpServer(
      { name: "aio-orchestrator", version: "0.1.0" },
      { capabilities: { tools: {} } }
    );

    this.setupTools();
  }

  private setupTools(): void {
    registerSessionTools(this.server, this.sessions, this.inbox, this.maxSessions);
    registerKnowledgeTools(this.server, this.search, this.vault);
    registerDagTools(this.server, this.planner, this.sessions, this.inbox, this.dagResults, this.maxSessions);
    registerBranchTools(this.server, this.branchHunt);
    registerWikiTools(this.server, this.vault, this.search);
  }

  async runStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("[MCP] aio-orchestrator stdio server started");
  }

  async runSSE(_host = "127.0.0.1", _port = 8910): Promise<void> {
    throw new Error("SSE transport not yet implemented");
  }
}

export function createMCPServer(maxSessions?: number): MCPServer {
  return new MCPServer(maxSessions);
}
