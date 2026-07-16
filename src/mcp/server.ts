import { createServer, IncomingMessage, ServerResponse } from "node:http";
import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createInbox } from "@/mcp/inbox";
import { ObsidianVault } from "@/knowledge/vault";
import { createEmbedder } from "@/knowledge/embedder";
import { SemanticSearch } from "@/knowledge/search";
import { resolveIndexDir, resolveProjectRoot, resolveVaultRoot } from "@/knowledge/paths";
import { DeepInterviewPlanner } from "@/orchestrator/planner";
import { BranchHunt } from "@/orchestrator/branch-hunt";
import { registerSessionTools, registerKnowledgeTools, registerDagTools, registerBranchTools, registerWikiTools, ChildSession } from "@/mcp/tools";

export interface MCPServerOptions {
  maxSessions?: number;
  vaultPath?: string;
}

export class MCPServer {
  private server: McpServer;
  private inbox = createInbox();
  private vault: ObsidianVault;
  private search: SemanticSearch;
  private sessions = new Map<string, ChildSession>();
  private dagResults = new Map<string, unknown>();
  private planner = new DeepInterviewPlanner();
  private branchHunt: BranchHunt;
  private maxSessions: number;
  readonly vaultRoot: string;
  readonly projectRoot: string;

  constructor(maxSessionsOrOptions: number | MCPServerOptions = 5) {
    const options: MCPServerOptions =
      typeof maxSessionsOrOptions === "number"
        ? { maxSessions: maxSessionsOrOptions }
        : maxSessionsOrOptions;

    this.maxSessions = options.maxSessions ?? 5;
    this.projectRoot = resolveProjectRoot();
    this.vaultRoot = resolveVaultRoot(options.vaultPath);
    this.vault = new ObsidianVault(this.vaultRoot);

    const embedder = createEmbedder();
    this.search = new SemanticSearch(embedder, resolveIndexDir(this.vaultRoot));
    this.branchHunt = new BranchHunt(this.inbox);

    this.server = new McpServer(
      { name: "aio-orchestrator", version: "2.0.2" },
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
    console.error(`[MCP] project root: ${this.projectRoot}`);
    console.error(`[MCP] vault root: ${this.vaultRoot}`);
    console.error(`[MCP] index dir: ${path.join(this.vaultRoot, ".index")}`);
  }

  async runSSE(host = "127.0.0.1", port = 8910): Promise<void> {
    const transports = new Map<string, SSEServerTransport>();

    const handleRequest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);

      if (req.method === "GET" && url.pathname === "/sse") {
        const transport = new SSEServerTransport("/messages", res);
        transports.set(transport.sessionId, transport);
        res.on("close", () => {
          transports.delete(transport.sessionId);
        });
        await this.server.connect(transport);
        return;
      }

      if (req.method === "POST" && url.pathname === "/messages") {
        const sessionId = url.searchParams.get("sessionId");
        const transport = sessionId ? transports.get(sessionId) : undefined;
        if (!transport) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Unknown or missing sessionId");
          return;
        }
        await transport.handlePostMessage(req, res);
        return;
      }

      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "ok",
          sessions: transports.size,
          projectRoot: this.projectRoot,
          vaultRoot: this.vaultRoot,
        }));
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    };

    const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
      handleRequest(req, res).catch((err) => {
        console.error("[MCP] SSE request error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end("Internal Server Error");
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(port, host, () => {
        httpServer.off("error", reject);
        resolve();
      });
    });

    console.error(`[MCP] aio-orchestrator SSE server listening on http://${host}:${port}/sse`);
    console.error(`[MCP] project root: ${this.projectRoot}`);
    console.error(`[MCP] vault root: ${this.vaultRoot}`);

    await new Promise<void>((resolve) => {
      const shutdown = () => {
        httpServer.close(() => resolve());
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });
  }
}

export function createMCPServer(maxSessionsOrOptions?: number | MCPServerOptions): MCPServer {
  return new MCPServer(maxSessionsOrOptions);
}
