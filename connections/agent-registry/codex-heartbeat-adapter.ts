import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
export async function renewCodexHeartbeat(input:{worker_id:string;runtime_id:string;session_id:string;correlation_token:string}) {
  const r=await execFileAsync("/Applications/ChatGPT.app/Contents/Resources/codex",["exec","resume",input.session_id,"--json","Return exactly: heartbeat-ok. Do not modify files."],{cwd:"/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE",timeout:60000,maxBuffer:2*1024*1024});
  const events=String(r.stdout).split("\n").filter(Boolean).map(x=>{try{return JSON.parse(x) as any}catch{return null}}).filter(Boolean);
  const executionSession=events.find((x:any)=>x.type==="thread.started")?.thread_id;
  if(executionSession!==input.session_id) throw new Error("HEARTBEAT_SESSION_CORRELATION_MISMATCH");
  const ok=events.some((x:any)=>x.type==="item.completed"&&x.item?.type==="agent_message"&&String(x.item.text??"").includes("heartbeat-ok"));
  if(!ok) throw new Error("HEARTBEAT_EVIDENCE_MISSING");
  return {worker_id:input.worker_id,runtime_id:input.runtime_id,session_id:input.session_id,correlation_token:input.correlation_token,transport_status:"RESPONSIVE",heartbeat_at:new Date().toISOString(),heartbeat_evidence_ref:`heartbeat-${input.correlation_token}`};
}

export async function renewClaudeHeartbeat(input:{worker_id:string;runtime_id:string;session_id:string;correlation_token:string}) {
  const r=await execFileAsync("/usr/local/bin/claude",["-p","--verbose","--resume",input.session_id,"--output-format","stream-json","--permission-mode","plan","--no-chrome","Return exactly: heartbeat-ok. Do not modify files."],{cwd:"/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE",timeout:60000,maxBuffer:2*1024*1024});
  const events=String(r.stdout).split("\n").filter(Boolean).map(x=>{try{return JSON.parse(x) as any}catch{return null}}).filter(Boolean);
  const executionSession=events.find((x:any)=>x.type==="system"&&x.subtype==="init")?.session_id;
  if(executionSession!==input.session_id) throw new Error("HEARTBEAT_SESSION_CORRELATION_MISMATCH");
  const ok=events.some((x:any)=>x.type==="assistant"&&x.message?.content?.some((p:any)=>String(p.text??"").includes("heartbeat-ok")));
  if(!ok) throw new Error("HEARTBEAT_EVIDENCE_MISSING");
  return {worker_id:input.worker_id,runtime_id:input.runtime_id,session_id:input.session_id,correlation_token:input.correlation_token,transport_status:"RESPONSIVE",heartbeat_at:new Date().toISOString(),heartbeat_evidence_ref:`heartbeat-${input.correlation_token}`};
}
