#!/usr/bin/env node
// Phase 23 close-out — a thin stdio MCP-shaped adapter over the SAME
// live Agent Gateway HTTP endpoints. Zero business logic here: every
// tool call is a straight HTTP passthrough to :8790 (or GATEWAY_URL env
// var, so it's not localhost-bound for a future remote transport). This
// is a TRANSPORT, per Phase 23's own rule — no duplicated orchestration.
//
// Speaks line-delimited JSON-RPC 2.0 over stdio, the real MCP wire shape
// (initialize, tools/list, tools/call) — no MCP SDK dependency added,
// since none exists in this repo (Phase 23 discovery: zero MCP
// implementation found anywhere).
import readline from "node:readline";
import http from "node:http";

const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:8790";

const TOOLS = [
  { name: "dna_status", route: "/gateway/dna_status", method: "GET" },
  { name: "dna_submit_task", route: "/gateway/dna_submit_task", method: "POST" },
  { name: "dna_task_status", route: "/gateway/dna_task_status", method: "POST" },
  { name: "dna_get_result", route: "/gateway/dna_get_result", method: "POST" },
  { name: "dna_explain", route: "/gateway/dna_explain", method: "POST" },
  { name: "dna_owner_decision", route: "/gateway/dna_owner_decision", method: "POST" },
];

function callGateway(tool, args) {
  return new Promise((resolve) => {
    const url = new URL(tool.route, GATEWAY_URL);
    if (tool.method === "GET") {
      http.get(url, (res) => { let out = ""; res.on("data", (c) => (out += c)); res.on("end", () => resolve({ status: res.statusCode, body: out })); }).on("error", (err) => resolve({ status: 0, error: err.message }));
      return;
    }
    const data = JSON.stringify(args || {});
    const req = http.request(url, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, (res) => {
      let out = ""; res.on("data", (c) => (out += c)); res.on("end", () => resolve({ status: res.statusCode, body: out }));
    });
    req.on("error", (err) => resolve({ status: 0, error: err.message }));
    req.write(data); req.end();
  });
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let req;
  try { req = JSON.parse(line); } catch { return; }

  if (req.method === "initialize") {
    send({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "dna-os-agent-gateway", version: "23.0.0" }, capabilities: { tools: {} } } });
    return;
  }
  if (req.method === "tools/list") {
    send({ jsonrpc: "2.0", id: req.id, result: { tools: TOOLS.map((t) => ({ name: t.name, description: `DNA OS Agent Gateway: ${t.name}` })) } });
    return;
  }
  if (req.method === "tools/call") {
    const toolName = req.params?.name;
    const tool = TOOLS.find((t) => t.name === toolName);
    if (!tool) {
      send({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `unknown tool: ${toolName}` } });
      return;
    }
    const result = await callGateway(tool, req.params?.arguments);
    send({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: result.body ?? JSON.stringify(result) }], isError: result.status !== 200 && result.status !== 0 ? false : !!result.error } });
    return;
  }
  send({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `unhandled method: ${req.method}` } });
});
