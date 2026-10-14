import { test } from "node:test";
import assert from "node:assert/strict";
import { keep } from "./discover.ts";

test("keep: MCP must be in the repo name, lists and courses are out, star floor applies", () => {
  const c = (repo: string, stars = 5000) => ({ repo, stars, desc: "mcp" });
  assert.equal(keep(c("github/github-mcp-server"), 1000), true);
  assert.equal(keep(c("BrowserMCP/mcp"), 1000), true);
  assert.equal(keep(c("modelcontextprotocol/inspector"), 1000), true);
  assert.equal(keep(c("n8n-io/n8n"), 1000), false); // mcp topic only
  assert.equal(keep(c("punkpeye/awesome-mcp-servers"), 1000), false);
  assert.equal(keep(c("microsoft/mcp-for-beginners"), 1000), false);
  assert.equal(keep(c("x/tiny-mcp", 999), 1000), false);
});
