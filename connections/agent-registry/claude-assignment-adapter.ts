import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WorkOrder } from "../../control/agent-gateway/types";
const execFileAsync = promisify(execFile);
const ROOT = "/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE";
export interface ClaudeAssignment { assignment_id:string; task_id:string; worker_id:string; provider:"claude-code"; runtime_id:string; session_id:string; correlation_token:string; work_order:WorkOrder; }
export async function executeClaudeAssignment(a: ClaudeAssignment) {
  const r=await execFileAsync("/usr/local/bin/claude",["-p","--verbose","--resume",a.session_id,"--output-format","stream-json","--permission-mode","plan","--no-chrome","Return exactly three lines: pwd; git rev-parse --show-toplevel; git branch --show-current. Do not modify files."],{cwd:ROOT,timeout:60000,maxBuffer:4*1024*1024});
  const events=String(r.stdout).split("\n").filter(Boolean).map(x=>{try{return JSON.parse(x) as any}catch{return null}}).filter(Boolean);
  const execution_session_id=events.find((x:any)=>x.type==="system"&&x.subtype==="init")?.session_id ?? events.find((x:any)=>x.session_id)?.session_id;
  if(execution_session_id!==a.session_id) throw new Error("SESSION_CORRELATION_MISMATCH");
  const text=events.find((x:any)=>x.type==="user"&&x.tool_use_result?.stdout)?.tool_use_result.stdout ?? events.find((x:any)=>x.type==="result")?.result ?? "";
  const lines=String(text).trim().split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(lines.length<3||lines[0]!==ROOT||lines[1]!==ROOT) throw new Error("PROBE_EVIDENCE_INVALID");
  return {evidence_id:`evidence-${a.assignment_id}`,assignment_id:a.assignment_id,task_id:a.task_id,worker_id:a.worker_id,assigned_session_id:a.session_id,execution_session_id,output:{cwd:lines[0],repository_root:lines[1],git_branch:lines[2]}};
}
