import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BranchHunt } from "@/orchestrator/branch-hunt";

export function registerBranchTools(
  server: McpServer,
  branchHunt: BranchHunt
): void {
  server.registerTool("scan_issues", {
    description: "Scan codebase, spawn fix sessions",
    inputSchema: z.object({ paths: z.array(z.string()).optional(), severity: z.enum(["low", "medium", "high", "critical"]).optional() }),
  }, async (args) => {
    const scanFn = async () => {
      return [{ description: `Scan requested for paths: ${args.paths?.join(", ") || "all files"}`, file: args.paths?.[0] || ".", severity: args.severity || "medium" }];
    };
    const issues = await branchHunt.scanForIssues(scanFn);
    return { content: [{ type: "text" as const, text: JSON.stringify({
      found: issues.length,
      issues: issues.map(i => ({ id: i.id, description: i.description, file: i.file, severity: i.severity, resolved: i.resolved }))
    }) }] };
  });

  server.registerTool("collect_results", {
    description: "Collect branch hunt results",
  }, async () => {
    const results = await branchHunt.collectResults();
    return { content: [{ type: "text" as const, text: JSON.stringify({ collected: results.length, results }) }] };
  });

  server.registerTool("get_branch_status", {
    description: "Branch hunt status summary",
  }, async () => ({
    content: [{ type: "text" as const, text: JSON.stringify({ summary: branchHunt.summary() }) }],
  }));
}
