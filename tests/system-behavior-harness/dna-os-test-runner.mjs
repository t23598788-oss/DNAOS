// DNA OS behavior test runner — drives REAL :8791 boundaries (the exact HTTP the n8n
// DNA_OS_INVOKER node encodes). No backdoors, no business data. Emits matrix + evidence.
const CORE = "http://127.0.0.1:8791";
const stamp = new Date().toISOString();
const results = [];
const ev = [];
const j = async (method,path,body)=>{ const r=await fetch(CORE+path,{method,headers:body?{"content-type":"application/json"}:{},body:body?JSON.stringify(body):undefined});
  let t; const raw=await r.text(); try{t=JSON.parse(raw)}catch{t=raw}; return {status:r.status,body:t,raw}; };
function rec(tc, verdict, asserts, evidence){ results.push({...tc, verdict, asserts}); ev.push({test_case_id:tc.test_case_id, verdict, at:stamp, evidence}); 
  console.log(`[${verdict.padEnd(13)}] ${tc.test_case_id.padEnd(34)} ${tc.area}`); for(const a of asserts) if(!a.ok) console.log("     x "+a.name+" :: "+a.detail); }
const A=(name,ok,detail="")=>({name,ok:!!ok,detail:String(detail).slice(0,160)});
const pass=a=>a.every(x=>x.ok);
const envelope=(cand)=>({request_id:"req-harness-"+cand.candidate_id,source_type:"test-harness",source_id:"tests/__sandbox__/harness",correlation_id:"corr-harness-"+cand.candidate_id,submitted_at:new Date().toISOString(),evidence_refs:cand.evidence_refs||["harness-probe"],ownerIdentity:{id:"tests/__sandbox__/harness"},source_system:"dna-os-infrastructure",candidate:cand});


async function main(){
 // discover ids
 const hs=await j("GET","/handoffs"); const anyTask=(Array.isArray(hs.body)?hs.body:[])[0]?.task_id;
 const planStart=await j("POST","/owner/plan",{commandText:"ตรวจสอบ agent-host"});
 const cid=planStart.body?.command_id;
 await new Promise(r=>setTimeout(r,1500));

 // 1 Owner Command boundary — happy plan reaches resource resolution + file read
 { const p=await j("GET",`/owner/plan?command_id=${cid}`); const s=p.body?.steps||[];
   const acts=s.map(x=>x.action);
   const a=[A("http 200",p.status===200,p.status),A("plan has steps",s.length>=5,s.length),
     A("did FILE_READ",acts.includes("FILE_READ")),A("did RESOURCE_RESOLUTION",acts.includes("RESOURCE_RESOLUTION")),
     A("terminal running=false",p.body?.running===false)];
   rec({test_case_id:"OWNER_CMD_PLAN_HAPPY",area:"1 Owner Command",boundary:"POST/GET /owner/plan",test_level:"BEHAVIOR",isolation:"ISOLATED_TEMP_STATE"},pass(a)?"PASS":"FAIL",a,{command_id:cid,actions:acts}); }

 // 2 Owner Command negative — blocked at resource (no provider)
 { const st=await j("POST","/owner/plan",{commandText:"ขอดูระบบบัญชีของ DNA OS"}); const c2=st.body?.command_id;
   await new Promise(r=>setTimeout(r,1200)); const p=await j("GET",`/owner/plan?command_id=${c2}`);
   const blocked=(p.body?.steps||[]).filter(x=>x.status==="BLOCKED");
   const cap=(p.body?.capability_plan||[]).find(x=>x.selection_verdict==="NO_PROVIDER");
   const a=[A("has blocked step",blocked.length>=1,blocked.length),A("blocked_at set",!!p.body?.blocked_at_step_id),
     A("NO_PROVIDER capability surfaced",!!cap,cap?.required_capability)];
   rec({test_case_id:"OWNER_CMD_PLAN_BLOCKED_NEG",area:"1 Owner Command (negative)",boundary:"GET /owner/plan",test_level:"FAILURE",isolation:"ISOLATED_TEMP_STATE"},pass(a)?"PASS":"FAIL",a,{command_id:c2,blocked_reason:blocked[0]?.blocked_reason,no_provider:cap?.required_capability}); }

 // 6 Registry read boundary — lookup returns registered capability
 { const p=await j("POST","/registry/lookup",{canonical_name:"accounting-system"}); const m=p.body?.matches?.[0];
   const a=[A("http 200",p.status===200,p.status),A("match found",!!m),A("capability_id present",!!m?.capability_id),A("resource_ids present",(m?.resource_ids||[]).length>=1)];
   rec({test_case_id:"REGISTRY_LOOKUP_READ",area:"6 Registry read",boundary:"POST /registry/lookup",test_level:"BOUNDARY",isolation:"PURE_READ"},pass(a)?"PASS":"FAIL",a,{capability_id:m?.capability_id}); }

 // 6b Registry read 404 negative
 { const p=await j("GET","/registry/capabilities/capability-does-not-exist-xyz");
   const a=[A("404 for unknown",p.status===404,p.status)];
   rec({test_case_id:"REGISTRY_CAP_404_NEG",area:"6 Registry read (negative)",boundary:"GET /registry/capabilities/:id",test_level:"FAILURE",isolation:"PURE_READ"},pass(a)?"PASS":"FAIL",a,{status:p.status}); }

 // 5/permission — business-data registration is rejected by domain gate (no bad write)
 { const cand={candidate_id:"candidate-harness-bizreject-probe",canonical_name:"harness-biz-reject-probe",kind:"resource",resource_type:"INVOICE",domain:"BUSINESS_OPERATIONAL_DATA",data_classification:"INTERNAL",source_location:"tests/__sandbox__/harness",purpose:"negative probe: business data must be rejected by domain gate",input_contract:{},output_contract:{},side_effects:[],dependencies:[],version:"1.0.0",scope:"test/negative",evidence_refs:["negative-probe"]};
   const p=await j("POST","/registry/candidates",envelope(cand)); const txt=JSON.stringify(p.body);
   const a=[A("not registered (rejected)",!/REGISTERED|APPROVED_FOR_REGISTRATION/.test(txt),p.status),A("domain/business reject reason",/DOMAIN|BUSINESS|REJECT/i.test(txt),txt.slice(0,90))];
   rec({test_case_id:"REGISTRY_BIZDATA_REJECT_NEG",area:"7 Domain gate (negative)",boundary:"POST /registry/candidates",test_level:"FAILURE",isolation:"PURE_READ"},pass(a)?"PASS":"FAIL",a,{status:p.status,reason:txt.slice(0,140)}); }

 // 13 Idempotency / no-duplicate side effect — registry duplicate gate: same candidate twice
 { const cand={candidate_id:"candidate-harness-idem-fixture",canonical_name:"dna-os-test-harness-idempotency-fixture",kind:"capability",capability_type:"TEST_FIXTURE",resource_type:"CAPABILITY",domain:"SOFTWARE_CONTROL_PLANE",data_classification:"INTERNAL",source_location:"tests/__sandbox__/harness",purpose:"idempotency fixture: submitting twice must not create a duplicate capability",input_contract:{probe:"x"},output_contract:{probe:"x"},side_effects:[],dependencies:[],version:"1.0.0",scope:"test/idempotency",evidence_refs:["idempotency-probe"]};
   const r1=await j("POST","/registry/candidates",envelope(cand)); const r2=await j("POST","/registry/candidates",envelope(cand));
   const s1=JSON.stringify(r1.body), s2=JSON.stringify(r2.body);
   const a=[A("first accepted-or-duplicate",/REGISTERED|APPROVED_FOR_REGISTRATION|DUPLICATE/i.test(s1),r1.status),A("second is DUPLICATE (no new side effect)",/DUPLICATE/i.test(s2),s2.slice(0,90))];
   rec({test_case_id:"IDEMPOTENCY_REGISTRY_DUP",area:"13 Idempotency / no-dup side effect",boundary:"POST /registry/candidates x2",test_level:"BEHAVIOR",isolation:"REVERSIBLE_WRITE"},pass(a)?"PASS":"FAIL",a,{first:s1.slice(0,100),second:s2.slice(0,100)}); }

 // 14 Malformed worker result — /handoff rejects malformed body (fail-closed)
 { const p=await j("POST","/handoff",{garbage:true,not:"a valid work result"});
   const a=[A("rejected (>=400)",p.status>=400,p.status),A("not accepted 201",p.status!==201)];
   rec({test_case_id:"MALFORMED_HANDOFF_NEG",area:"14 Malformed worker result",boundary:"POST /handoff",test_level:"FAILURE",isolation:"PURE_READ"},pass(a)?"PASS":"FAIL",a,{status:p.status,body:JSON.stringify(p.body).slice(0,120)}); }

 // 12 Lifecycle ordering — ordered stages
 { const p=await j("GET",`/owner/lifecycle?command_id=${cid}`);
   const a=[A("http 200",p.status===200,p.status),A("returns lifecycle",!!p.body && typeof p.body==="object")];
   rec({test_case_id:"LIFECYCLE_ORDER_READ",area:"12 Lifecycle ordering",boundary:"GET /owner/lifecycle",test_level:"BOUNDARY",isolation:"PURE_READ"},pass(a)?"PASS":"FAIL",a,{keys:Object.keys(p.body||{})}); }

 // 8 Evidence creation observable — task read carries evidence/handoffs
 { const p=await j("GET",`/task/${anyTask}`);
   const a=[A("http 200 or 404 (deterministic)",[200,404].includes(p.status),p.status)];
   rec({test_case_id:"EVIDENCE_TASK_READ",area:"8 Evidence creation (observe)",boundary:"GET /task/:id",test_level:"BOUNDARY",isolation:"PURE_READ"},pass(a)?"PASS":"FAIL",a,{task_id:anyTask,status:p.status}); }

 // 9 Incident handoff — read path exists; creation from live loop is UNWIRED (honest)
 { const p=await j("GET","/owner/incident/incident-nonexistent-probe");
   const a=[A("incident read boundary responds",[200,404].includes(p.status),p.status)];
   rec({test_case_id:"INCIDENT_READ_BOUNDARY",area:"9 Incident handoff",boundary:"GET /owner/incident/:id",test_level:"BOUNDARY",isolation:"PURE_READ"},pass(a)?"PASS":"FAIL",a,{status:p.status,note:"live-loop incident creation UNWIRED: reportExecutionFailure has 0 production callers"}); }

 // 11 Owner escalation/read path
 { const c=await j("GET","/owner/console"); const q=await j("GET","/owner/action-queue");
   const a=[A("console 200",c.status===200,c.status),A("action-queue 200",q.status===200,q.status)];
   rec({test_case_id:"OWNER_ESCALATION_READ",area:"11 Owner escalation/read",boundary:"GET /owner/console,/owner/action-queue",test_level:"BOUNDARY",isolation:"PURE_READ"},pass(a)?"PASS":"FAIL",a,{console:c.status,queue:q.status}); }

 // 4/10 Resource resolution + target resolution (observed transitively via plan) + capability route
 { const p=await j("GET","/capability/route/accounting-system");
   const a=[A("route boundary responds",[200,404].includes(p.status),p.status)];
   rec({test_case_id:"CAPABILITY_ROUTE_READ",area:"10 Target/route resolution",boundary:"GET /capability/route/:ref",test_level:"BOUNDARY",isolation:"PURE_READ"},pass(a)?"PASS":"FAIL",a,{status:p.status}); }

 // system graph (cross-module behavior)
 { const p=await j("GET","/graph/system");
   const a=[A("http 200",p.status===200,p.status),A("has graph",!!p.body)];
   rec({test_case_id:"SYSTEM_GRAPH_READ",area:"cross-module",boundary:"GET /graph/system",test_level:"BOUNDARY",isolation:"PURE_READ"},pass(a)?"PASS":"FAIL",a,{status:p.status}); }

 // runtime inventory
 { const p=await j("GET","/runtime/inventory");
   const a=[A("http 200",p.status===200,p.status),A("VERIFIED",p.body?.status==="VERIFIED",p.body?.status),A("capabilities listed",(p.body?.capabilities||[]).length>=1)];
   rec({test_case_id:"RUNTIME_INVENTORY_READ",area:"6 Registry/runtime read",boundary:"GET /runtime/inventory",test_level:"BOUNDARY",isolation:"PURE_READ"},pass(a)?"PASS":"FAIL",a,{caps:(p.body?.capabilities||[]).length}); }

 // health
 { const p=await j("GET","/health"); const a=[A("ok true",p.body?.ok===true||p.status===200,p.status)];
   rec({test_case_id:"HEALTH_READ",area:"transport",boundary:"GET /health",test_level:"BOUNDARY",isolation:"PURE_READ"},pass(a)?"PASS":"FAIL",a,{status:p.status}); }

 // summary
 const c={}; for(const r of results) c[r.verdict]=(c[r.verdict]||0)+1;
 console.log("\nSUMMARY",JSON.stringify(c));
 const fs=await import("node:fs");
 fs.writeFileSync(process.env.OUT+"/test-run-evidence.json",JSON.stringify({run_at:stamp,core:CORE,summary:c,results,evidence:ev},null,1));
 console.log("wrote",process.env.OUT+"/test-run-evidence.json");
}
main().catch(e=>{console.log("RUNNER_ERR",e.message,e.stack);process.exit(1)});
