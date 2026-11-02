// Connects to Kinwarden's MCP endpoint with the official MCP client library and makes read-only calls.
//   node scripts/mcp-check.mjs                                  # http://localhost:3000/api/mcp
//   node scripts/mcp-check.mjs "http://localhost:3000/api/mcp?world=<id>"
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.argv[2] ?? "http://localhost:3000/api/mcp");
const client = new Client({ name: "kinwarden-mcp-check", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(url));
console.log("server:", client.getServerVersion()?.title, "· protocol ok");

const { tools } = await client.listTools();
console.log(`tools (${tools.length}):`, tools.map((t) => t.name).join(", "));

const listed = await client.callTool({ name: "list_cases", arguments: {} });
const { cases } = JSON.parse(listed.content[0].text);
console.log("cases:", cases.map((c) => `${c.case_id} (${c.corridor}, ${c.status})`).join("; "));

if (cases[0]) {
  const overview = await client.callTool({ name: "get_case_overview", arguments: { case_id: cases[0].case_id } });
  const text = overview.content[0].text;
  console.log(`get_case_overview ${cases[0].case_id}: ${text.length} chars, masked tokens: ${(text.match(/\[[A-Z_]+_\d+\]/g) ?? []).length}`);
}
await client.close();
