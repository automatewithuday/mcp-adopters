export const SEED_REPOS = [
  "modelcontextprotocol/servers",
  "modelcontextprotocol/python-sdk",
  "modelcontextprotocol/typescript-sdk",
  "github/github-mcp-server",
  "microsoft/playwright-mcp",
  "GLips/Figma-Context-MCP",
  "mark3labs/mcp-go",
  "awslabs/mcp",
  "PrefectHQ/fastmcp",
  "googleapis/mcp-toolbox",
];

/** Repo owner → company names that count as "works there". Lowercase, alphanumeric only. Add as repos are added. */
export const OWNER_ALIASES: Record<string, string[]> = {
  modelcontextprotocol: ["anthropic", "anthropics"],
  prefecthq: ["prefect", "prefecthq"],
  googleapis: ["google", "googleapis"],
  awslabs: ["aws", "amazon", "awslabs", "amazonwebservices"],
  microsoft: ["microsoft"],
  github: ["github", "githubinc"],
  mark3labs: ["mark3labs"],
  glips: ["glips"],
};
