const $ = (id) => document.getElementById(id);
let payload = { pits: [], materialTypes: [], facilityTypes: [], counters: {} }, selectedPitId = null, activeAction = null, pendingDelete = null, view = "all", viewHistory = ["all"], historyIndex = 0;
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const currency = (v) => Number.isFinite(Number(v)) && Number(v) > 0 ? new Intl.NumberFormat("th-TH", { style:"currency", currency:"THB", maximumFractionDigits:2 }).format(Number(v)) : "ไม่มีราคา";
function toast(m){$("toast").textContent=m;$("toast").style.display="block";setTimeout(()=>$("toast").style.display="none",3500)}
function setLive(k,m){$("liveStatus").className=`live-status ${k}`;$("liveStatus").textContent=m}
function setFormStatus(k,m){$("formStatus").className=`form-status ${k}`;$("formStatus").textContent=m}
function apiMessage(r,d,fallback){return r.status===401||r.status===403?"ไม่มีสิทธิ์ดำเนินการ กรุณาเข้าสู่ระบบด้วยสิทธิ์ที่อนุญาต":typeof d?.error==="string"?d.error:fallback}
function selectedPit(){return payload.pits.find((p)=>p.id===selectedPitId)??null}
function hasGps(p){return Number.isFinite(Number(p?.lat))&&Number(p.lat)!==0&&Number.isFinite(Number(p?.lng))&&Number(p.lng)!==0}
function qualityIssues(){const out=[],linked=new Set(payload.pits.flatMap(p=>p.materials??[]).map(m=>m.material_type_id));for(const p of payload.pits){if(p.active&&!hasGps(p))out.push({type:"edit",pitId:p.id,title:`${p.name}: ไม่มี GPS`,detail:"ต้องระบุละติจูดและลองจิจูด"});if(p.active&&!(p.materials??[]).length)out.push({type:"price",pitId:p.id,title:`${p.name}: ยังไม่ผูกวัสดุ`,detail:"ยังไม่มีความสัมพันธ์วัสดุกับแหล่ง"});for(const m of p.materials??[])if(!Number.isFinite(Number(m.price))||Number(m.price)<=0)out.push({type:"price",pitId:p.id,materialId:m.material_type_id,title:`${p.name}: ${m.name} ไม่มีราคา`,detail:"ต้องระบุราคามากกว่า 0"})}for(const m of payload.materialTypes??[])if(!linked.has(m.id))out.push({type:"price",materialId:m.id,title:`${m.name}: ยังไม่ผูกกับแหล่ง`,detail:"เลือกแหล่งและบันทึกราคาเพื่อผูกวัสดุ"});return out}
function render(){const search=$("search").value.trim().toLowerCase(),category=$("category").value,pits=payload.pits.filter(p=>(!category||p.business_type_label===category)&&(!search||[p.name,p.company_name,p.business_type_label,...(p.materials??[]).map(m=>m.name)].join(" ").toLowerCase().includes(search))),types=[...new Set(payload.pits.map(p=>p.business_type_label).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"th")),c=payload.counters??{};$("category").innerHTML=`<option value="">ทุกประเภทแหล่ง</option>${types.map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join("")}`;$("category").value=types.includes(category)?category:"";$("counters").innerHTML=`<span>Total<b>${Number(c.total??0)}</b></span><span>Active<b>${Number(c.active??0)}</b></span><span>Inactive<b>${Number(c.inactive??0)}</b></span><span>Missing price<b>${Number(c.missing_price??0)}</b></span><span>Missing GPS<b>${Number(c.missing_gps??0)}</b></span><span>Unlinked materials<b>${qualityIssues().filter(i=>!i.pitId).length}</b></span>`;$("pitCount").textContent=`${pits.length} รายการ`;$("pitList").innerHTML=pits.map(p=>`<button class="pit-item ${p.id===selectedPitId?"selected":""}" data-pit-id="${esc(p.id)}"><strong>${esc(p.name||"ไม่ระบุชื่อ")}</strong><span>${esc(p.company_name||p.contact_name||"ไม่ระบุบริษัท/เจ้าของ")}</span><span>${esc(p.business_type_label||"ไม่ระบุประเภท")} · ${(p.materials??[]).length} วัสดุ</span><em>${p.active&&p.is_open?(hasGps(p)?"พร้อมใช้งาน":"ไม่มี GPS"):"ปิดใช้งาน"}</em></button>`).join("")||`<p class="empty">ไม่พบแหล่งทรัพยากรตามเงื่อนไข</p>`;$("pitList").querySelectorAll("[data-pit-id]").forEach(b=>b.onclick=()=>{selectedPitId=b.dataset.pitId;render();if(activeAction==="edit"||activeAction==="price")openAction(activeAction)});const issues=qualityIssues();$("issueCount").textContent=`${issues.length} จุด`;$("issueList").innerHTML=issues.map((i,n)=>`<button class="issue-item" data-issue-index="${n}"><strong>${esc(i.title)}</strong><span>${esc(i.detail)}</span></button>`).join("")||`<p class="empty">ไม่พบข้อมูลที่ขาดจากรายการที่อ่านได้</p>`;$("issueList").querySelectorAll("[data-issue-index]").forEach(b=>b.onclick=()=>{const i=issues[Number(b.dataset.issueIndex)];selectedPitId=i.pitId??selectedPitId;render();openAction(i.type,i.materialId)});const p=selectedPit();$("selectedSummary").innerHTML=p?`<strong>${esc(p.name)}</strong><span>${esc(p.company_name||p.contact_name||"ไม่ระบุบริษัท/เจ้าของ")}</span><span>${esc(p.address||"ไม่มีที่อยู่")}</span><span>${hasGps(p)?`${p.lat}, ${p.lng}`:"ไม่มี GPS"} · ${p.active&&p.is_open?"ใช้งาน":"ปิดใช้งาน"}</span>`:"ยังไม่ได้เลือกแหล่งทรัพยากร";$("materialCount").textContent=p?`${(p.materials??[]).length} รายการ`:"—";$("materialList").innerHTML=p?(p.materials??[]).map(m=>`<div class="material-item"><button data-material-id="${esc(m.material_type_id)}"><strong>${esc(m.name)}</strong><span>${currency(m.price)}</span></button><button class="unlink" data-unlink-id="${esc(m.material_type_id)}" title="ยกเลิกวัสดุจากแหล่ง">×</button></div>`).join("")||`<p class="empty">ยังไม่มีวัสดุผูกกับแหล่งนี้</p>`:`<p class="empty">เลือกแหล่งเพื่อดูวัสดุและราคา</p>`;$("materialList").querySelectorAll("[data-material-id]").forEach(b=>b.onclick=()=>openAction("price",b.dataset.materialId));$("materialList").querySelectorAll("[data-unlink-id]").forEach(b=>b.onclick=()=>previewUnlink(b.dataset.unlinkId))}
function field(label,name,value="",extra=""){return `<label>${esc(label)}<input name="${esc(name)}" value="${esc(value)}" ${extra}></label>`}function selectField(label,name,options,value=""){return `<label>${esc(label)}<select name="${esc(name)}"><option value="">ไม่ระบุ</option>${options.map(o=>`<option value="${esc(o.id)}" ${o.id===value?"selected":""}>${esc(o.label)}</option>`).join("")}</select></label>`}const formButtons=(label)=>`<div class="form-actions"><button type="button" data-cancel>ยกเลิก</button><button class="primary" type="submit">${esc(label)}</button></div>`;
function unsupported(m){$("formTitle").textContent=m;$("formLead").textContent="ไม่มี writer ที่ได้รับอนุมัติสำหรับ action นี้ จึงไม่มีการส่งหรือบันทึกข้อมูล";$("controlForm").innerHTML=`<div class="unsupported"><strong>ยังไม่รองรับ</strong><p>${esc(m)}</p></div>`;setFormStatus("neutral","ยังไม่ส่งคำขอไปยัง API")}
function openAction(action,materialId){activeAction=action;pendingDelete=null;$("cancelForm").hidden=false;const p=selectedPit();if(action==="quality"){$("formTitle").textContent="ตรวจข้อมูลที่ขาด";$("formLead").textContent="รายการปัญหาคำนวณจากข้อมูลที่อ่านได้จริงใน Supabase";$("controlForm").innerHTML=`<div class="quality-summary">พบ ${qualityIssues().length} จุด — เลือกรายการปัญหาทางซ้ายเพื่อเปิดจุดแก้ไข</div>`;setFormStatus("neutral","ไม่มีการเขียนข้อมูล");return}if(action==="disable"){if(!p){$("formTitle").textContent="เลือกแหล่งทรัพยากร";$("formLead").textContent="เลือกแหล่งก่อนตรวจผลกระทบการปิดใช้งานหรือลบ";$("controlForm").innerHTML="";setFormStatus("warning","ต้องเลือกแหล่งก่อนดำเนินการ");return}previewPitDelete();return}if(action==="master")return unsupported("Material Master ยังไม่มี canonical writer ที่อนุมัติ");if(action==="create"){$("formTitle").textContent="เพิ่มทรัพยากร";$("formLead").textContent="สร้างแหล่งใหม่ใน pit_profiles ผ่าน API เดิม";$("controlForm").innerHTML=`<div class="form-grid">${field("ชื่อบ่อ / แหล่ง *","pit_name","","required maxlength=200")}${field("บริษัท / เจ้าของแหล่ง","registered_name")}${field("ผู้ติดต่อ","contact_name")}${field("โทรศัพท์","phone")}${field("ที่อยู่","address")}${field("ละติจูด","latitude","","inputmode=decimal")}${field("ลองจิจูด","longitude","","inputmode=decimal")}${selectField("ประเภทสถานประกอบการ","facility_type_id",(payload.facilityTypes??[]).map(t=>({id:t.id,label:t.name_th||t.name||t.code})))}</div>${formButtons("บันทึกแหล่งทรัพยากร")}`;setFormStatus("neutral","พร้อมบันทึกผ่าน POST /api/admin/pits");return}if(!p){$("formTitle").textContent="เลือกแหล่งทรัพยากร";$("formLead").textContent="เลือกแหล่งจากรายการด้านซ้ายก่อนแก้ไขข้อมูลหรือราคา";$("controlForm").innerHTML="";setFormStatus("warning","ต้องเลือกแหล่งก่อนดำเนินการ");return}if(action==="edit"){$("formTitle").textContent="แก้ไขข้อมูลแหล่ง";$("formLead").textContent=`แก้ไขข้อมูลจริงของ ${p.name} ผ่าน API เดิม`;$("controlForm").innerHTML=`<div class="form-grid">${field("ชื่อบ่อ / แหล่ง *","pit_name",p.name,"required maxlength=200")}${field("บริษัท / เจ้าของแหล่ง","registered_name",p.company_name??"")}${field("ผู้ติดต่อ","contact_name",p.contact_name??"")}${field("โทรศัพท์","phone",p.phone??"")}${field("ที่อยู่","address",p.address??"")}${field("ละติจูด","latitude",p.lat??"","required inputmode=decimal")}${field("ลองจิจูด","longitude",p.lng??"","required inputmode=decimal")}${selectField("ประเภทสถานประกอบการ","facility_type_id",(payload.facilityTypes??[]).map(t=>({id:t.id,label:t.name_th||t.name||t.code})),p.facility_type_id??"")}</div>${formButtons("บันทึกข้อมูลแหล่ง")}`;setFormStatus("neutral",`พร้อมบันทึกผ่าน PATCH /api/admin/pits/${p.id}`);return}const existing=(p.materials??[]).find(m=>m.material_type_id===materialId);$("formTitle").textContent="จัดการราคาวัสดุต่อแหล่ง";$("formLead").textContent=`บันทึกเฉพาะราคา per pit/material ของ ${p.name}`;$("controlForm").innerHTML=`<div class="form-grid">${selectField("วัสดุ *","material_type_id",(payload.materialTypes??[]).map(m=>({id:m.id,label:m.name})),materialId??"")}${field("ราคา / คิว (บาท) *","price",existing?.price??"","required inputmode=decimal type=number min=0.01 step=0.01")}</div><p class="form-note">Material Master เป็น read-only; การบันทึกนี้ใช้เฉพาะ POST /api/admin/pits/[pitId]/materials</p>${formButtons("บันทึกราคา")}`;setFormStatus("neutral",`พร้อมบันทึกผ่าน POST /api/admin/pits/${p.id}/materials`)}
function makeOperationId(){return globalThis.crypto?.randomUUID?.()||`${Date.now()}0000-0000-4000-8000-000000000000`.slice(0,36)}
function dependencyRows(d){const graph=d.dependency_graph||{},fk=Array.isArray(graph.foreign_keys)?graph.foreign_keys:[],refs=Array.isArray(graph.canonical_references)?graph.canonical_references:[];return [...fk,...refs].map(x=>`<li><strong>${esc(x.table)}</strong>: ${Number(x.active_count??x.count??0)} — ${esc(x.action||"retain")}</li>`).join("")||"<li>ไม่พบความสัมพันธ์ที่ route ตรวจได้</li>"}
async function previewPitDelete(){const p=selectedPit();if(!p)return;setFormStatus("saving","กำลังตรวจ dependency ล่าสุดก่อนดำเนินการ…");try{const r=await fetch(`/api/admin/pits/${encodeURIComponent(p.id)}`,{method:"DELETE",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"preview"})}),d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(apiMessage(r,d,"ตรวจผลกระทบไม่สำเร็จ")),{status:r.status});pendingDelete={kind:"pit",data:d,operationId:makeOperationId()};const plan=d.deactivation_plan||{},archive=plan.records_to_archive||{},retain=plan.records_to_retain||{},documents=d.dependency_graph?.documents_and_transactions||{},cost=d.dependency_graph?.cost_engine||{};$("formTitle").textContent="ตรวจ dependency ก่อนลบ / ปิดใช้งาน";$("formLead").textContent="ผลตรวจจากฐานข้อมูลล่าสุด; server จะตรวจซ้ำอีกครั้งก่อนเขียน";$("controlForm").innerHTML=`<div class="danger-box"><strong>Target record</strong><br>Record ID: <code>${esc(d.pit.id)}</code><br>บริษัท/เจ้าของ: ${esc(d.pit.company_name||"ไม่ระบุ")}<br>แหล่ง: ${esc(d.pit.name)}<h3>Dependency graph</h3><ul>${dependencyRows(d)}</ul><p><strong>เอกสาร/ธุรกรรม:</strong> ${esc(documents.discovery||"ไม่พบข้อมูล")}</p><p><strong>Cost Engine:</strong> ${esc(cost.effect||"ไม่พบข้อมูล")}</p><h3>DEACTIVATE RESOURCE</h3><p>จะปิด: pit_profiles ${Number(archive.pit_profiles||1)} รายการ และ archive ราคา/ความสัมพันธ์วัสดุ active ${Number(archive.active_pit_materials||0)} รายการ</p><p>ต้องเก็บไว้: price requests ${Number(retain.pit_price_requests||0)}, partner links ${Number(retain.partners||0)}, jobs ${Number(retain.jobs||0)}, Material Master ทั้งหมด</p><h3>DELETE RECORD</h3>${d.permanent_delete_allowed?"<p>อนุญาตเฉพาะ test/demo record ที่ไม่มี dependency ที่ห้ามลบ</p>":`<p>ไม่อนุญาตลบถาวร: ${esc((d.permanent_delete_blockers||[]).join(", ")||"มี dependency")}</p>`}<label>พิมพ์ <strong>ชื่อแหล่ง</strong> หรือ <strong>Record ID</strong> เพื่อยืนยัน<input name="confirmation" autocomplete="off" required></label><label><input type="checkbox" name="confirm" required> ยืนยันว่าเข้าใจผลกระทบและให้ server ตรวจสิทธิ์/ความสัมพันธ์ซ้ำ</label></div><div class="form-actions"><button type="button" data-cancel>ยกเลิก</button><button type="button" class="danger" data-delete-action="deactivate">DEACTIVATE RESOURCE</button>${d.permanent_delete_allowed?'<button type="button" class="danger" data-delete-action="delete_test">DELETE RECORD</button>':""}</div>`;$("controlForm").querySelectorAll("[data-delete-action]").forEach(b=>b.onclick=()=>confirmPitDelete(b.dataset.deleteAction));setFormStatus("warning","ต้องพิมพ์ชื่อหรือ Record ID และยืนยันก่อนส่งคำสั่ง")}catch(err){setFormStatus("error",err instanceof Error?err.message:"ตรวจผลกระทบไม่สำเร็จ")}}
async function confirmPitDelete(action){const form=$("controlForm"),confirm=form.querySelector('[name="confirm"]'),confirmation=form.querySelector('[name="confirmation"]'),p=selectedPit();if(!p||!pendingDelete?.operationId)return;if(!confirm?.checked){setFormStatus("error","ต้องยืนยันผลกระทบก่อนดำเนินการ");return}if(!String(confirmation?.value||"").trim()){setFormStatus("error","ต้องพิมพ์ชื่อแหล่งหรือ Record ID เพื่อยืนยัน");return}form.querySelectorAll("button").forEach(b=>b.disabled=true);const d=await callMutation(`/api/admin/pits/${encodeURIComponent(p.id)}`,"DELETE",{action,confirmation:String(confirmation.value).trim(),operation_id:pendingDelete.operationId},`${action==="deactivate"?"ปิดใช้งานแหล่ง":"ลบข้อมูลทดสอบ"}สำเร็จ`);if(d?.replayed)toast("คำสั่งเดิมถูกดำเนินการแล้ว จึงไม่ส่งซ้ำ");if(d&&action==="delete_test")selectedPitId=null}
function previewUnlink(materialTypeId){const p=selectedPit(),m=(p?.materials??[]).find(x=>x.material_type_id===materialTypeId);if(!p||!m)return;activeAction="unlink";pendingDelete={kind:"material",materialTypeId};$("cancelForm").hidden=false;$("formTitle").textContent="ยืนยันยกเลิกวัสดุจากแหล่ง";$("formLead").textContent="จะ archive ความสัมพันธ์ราคาเดียว โดยไม่ลบ Material Master";$("controlForm").innerHTML=`<div class="danger-box"><strong>บริษัท/เจ้าของ: ${esc(p.company_name||p.contact_name||"ไม่ระบุ")}</strong><br>แหล่ง: ${esc(p.name)}<br>วัสดุ: ${esc(m.name)}<br>ราคา: ${currency(m.price)}<p>ผลกระทบ: ราคาแหล่งนี้จะไม่ถูกอ่านโดย pricing/cost สำหรับวัสดุนี้อีกต่อไป; วัสดุและแหล่งอื่นไม่เปลี่ยน</p><label><input type="checkbox" name="confirm" required> ยืนยันการยกเลิกความสัมพันธ์</label></div><div class="form-actions"><button type="button" data-cancel>ยกเลิก</button><button type="button" class="danger" data-confirm-unlink>ยกเลิกวัสดุจากแหล่ง</button></div>`;$("controlForm").querySelector("[data-confirm-unlink]").onclick=async()=>{if(!$("controlForm").querySelector('[name="confirm"]')?.checked){setFormStatus("error","ต้องยืนยันผลกระทบก่อนดำเนินการ");return}await callMutation(`/api/admin/pits/${encodeURIComponent(p.id)}/materials`,"DELETE",{material_type_id:materialTypeId},"ยกเลิกความสัมพันธ์วัสดุสำเร็จ")};setFormStatus("warning","กรุณายืนยันก่อนส่งคำสั่ง")}
async function callMutation(url,method,body,success){setFormStatus("saving","กำลังบันทึกและรอยืนยันจากฐานข้อมูล…");setLive("saving","กำลังส่งข้อมูลไปยัง API เดิม…");try{const r=await fetch(url,{method,credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(apiMessage(r,d,"บันทึกไม่สำเร็จ")),{status:r.status});await loadExistingMaterials(false);setFormStatus("success",`${success} — อ่านข้อมูลกลับจากฐานข้อมูลแล้ว`);setLive("success",`${success} จาก API เดิม`);toast(success);return d}catch(err){const m=err?.status===401||err?.status===403?"ไม่มีสิทธิ์ดำเนินการ":err instanceof Error?err.message:"ขาดการเชื่อมต่อหรือบันทึกไม่สำเร็จ";setFormStatus("error",`บันทึกไม่สำเร็จ: ${m}`);setLive(err?.status?"error":"offline",err?.status?`API error: ${m}`:"ขาดการเชื่อมต่อกับระบบข้อมูล");return null}}
async function submitForm(e){
  e.preventDefault();
  const f=new FormData(e.currentTarget),p=selectedPit();
  let url="/api/admin/pits",method="POST",body;
  if(activeAction==="create"){
    body={pit_name:String(f.get("pit_name")??"").trim(),registered_name:String(f.get("registered_name")??"").trim(),contact_name:String(f.get("contact_name")??"").trim(),phone:String(f.get("phone")??"").trim(),address:String(f.get("address")??"").trim()||null};
    const t=String(f.get("facility_type_id")??"");
    if(t)body.facility_type_id=t;
    const lat=String(f.get("latitude")??"").trim(),lng=String(f.get("longitude")??"").trim();
    if(lat||lng){body.latitude=Number(lat);body.longitude=Number(lng)}
  }else if(activeAction==="edit"&&p){
    url=`/api/admin/pits/${encodeURIComponent(p.id)}`;method="PATCH";
    body={pit_name:String(f.get("pit_name")??"").trim(),registered_name:String(f.get("registered_name")??"").trim(),contact_name:String(f.get("contact_name")??"").trim(),phone:String(f.get("phone")??"").trim(),address:String(f.get("address")??"").trim(),latitude:Number(f.get("latitude")),longitude:Number(f.get("longitude")),facility_type_id:String(f.get("facility_type_id")??"")||null};
  }else if(activeAction==="price"&&p){
    url=`/api/admin/pits/${encodeURIComponent(p.id)}/materials`;
    body={material_type_id:String(f.get("material_type_id")??""),price:Number(f.get("price"))};
  }else return;
  if(!body.pit_name&&activeAction!=="price"){setFormStatus("error","ต้องระบุชื่อบ่อ / แหล่ง");return}
  if(activeAction==="price"&&(!body.material_type_id||!Number.isFinite(body.price)||body.price<=0)){setFormStatus("error","ต้องเลือกวัสดุและระบุราคามากกว่า 0");return}
  const needsGps=activeAction==="edit"||(activeAction==="create"&&(body.latitude!==undefined||body.longitude!==undefined));
  if(needsGps&&(!Number.isFinite(body.latitude)||!Number.isFinite(body.longitude)||body.latitude===0||body.longitude===0)){setFormStatus("error","พิกัดต้องเป็นตัวเลขและไม่เป็น 0");return}
  const d=await callMutation(url,method,body,activeAction==="create"?"เพิ่มแหล่งทรัพยากรสำเร็จ":activeAction==="edit"?"แก้ไขข้อมูลแหล่งสำเร็จ":"บันทึกราคาสำเร็จ");
  if(d&&activeAction==="create")selectedPitId=d.pit?.id??selectedPitId;
}
async function loadExistingMaterials(initial=true){setLive("loading","กำลังโหลดข้อมูลจาก Supabase ผ่าน API เดิม…");try{const r=await fetch("/api/admin/pits",{credentials:"same-origin"}),d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(apiMessage(r,d,"โหลดข้อมูลไม่สำเร็จ")),{status:r.status});payload={pits:Array.isArray(d.pits)?d.pits:[],materialTypes:Array.isArray(d.materialTypes)?d.materialTypes:[],facilityTypes:Array.isArray(d.facilityTypes)?d.facilityTypes:[],counters:d.counters??{}};if(selectedPitId&&!payload.pits.some(p=>p.id===selectedPitId))selectedPitId=null;render();setLive("success",`โหลดข้อมูลสำเร็จ: ${payload.counters.total??payload.pits.length} แหล่งทรัพยากร`);if(initial)setFormStatus("neutral","พร้อมใช้งาน")}catch(err){payload={pits:[],materialTypes:[],facilityTypes:[],counters:{}};render();const m=err?.status===401||err?.status===403?"ไม่มีสิทธิ์เข้าถึงข้อมูล":err instanceof Error?err.message:"ขาดการเชื่อมต่อกับระบบข้อมูล";setLive(err?.status?"error":"offline",m);setFormStatus("error",m)}}
function resetForm(){activeAction=null;pendingDelete=null;$("formTitle").textContent="เลือกเครื่องมือ";$("formLead").textContent="เลือกแหล่งทรัพยากรหรือเครื่องมือเพื่อเริ่มทำงาน";$("controlForm").innerHTML="";$("cancelForm").hidden=true;setFormStatus("neutral","พร้อมใช้งาน")}
/* ── TAB BAR (owner 2026-10-18) ─────────────────────────────────────────────
   แถบบน = พื้นที่ของ "หน้าจอที่เปิดอยู่" เท่านั้น (ไม่ใช่ช่องค้นหา/จัดการทรัพยากร)
     • Workspace           → หน้าจอแชตเดิม (#chatFrame) — แท็บหลัก ปิดไม่ได้
     • ศูนย์ควบคุมทรัพยากร  → ผิวเดิม (#stockPane) เปิดจากไอคอน ▤ ในแถบซ้าย
     • เครื่องมือ / เว็บไซต์ → เปิดในพื้นที่กลาง (#toolFrame) ที่มีอยู่เดิม
   เปิดหน้าจอที่เปิดอยู่แล้ว = สลับไปแท็บเดิม (id เดียวกัน) ไม่สร้างแท็บซ้ำ
   ปุ่ม ‹ › ใช้ประวัติการนำทางของ shell นี้จริง: บันทึกทุกครั้งที่ผู้ใช้เปิด/สลับหน้าจอ */
const TAB_ICON = {
  chat:'<path d="M21 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 19 0Z"/><path d="M7 10h9M7 14h6"/>',
  stock:'<path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8"/>',
  /* ไม่ใช้ไอคอน "สี่เหลี่ยม 4 ช่อง" ซ้ำ: จุดนั้นเป็นของปุ่มเปิดเครื่องมือ (#toolsMain) จุดเดียว */
  tools:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5"/>',
  external:'<path d="M14 3h7v7M21 3 10 14"/><path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6"/>'
};
const tabIcon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TAB_ICON[name] || TAB_ICON.tools}</svg>`;
const HOME_TAB = { id: "workspace", label: "Workspace", kind: "chat", icon: "chat", closable: false };
let tabs = [HOME_TAB], activeTabId = HOME_TAB.id, navHistory = [HOME_TAB.id], navIndex = 0;
function currentTab(){ return tabs.find((t) => t.id === activeTabId) || tabs[0] }
function syncTabChrome(){
  $("back").disabled = navIndex === 0;
  $("forward").disabled = navIndex >= navHistory.length - 1;
  const kind = currentTab()?.kind;
  document.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("active", kind === "resource" && b.dataset.view === "all"));
  $("chatHome").classList.toggle("active", kind === "chat");
}
function renderTabs(){
  const strip = $("tabStrip");
  if (!strip) return;
  strip.innerHTML = tabs.map((tab) => {
    const active = tab.id === activeTabId;
    const visual = tab.logo ? `<img src="${esc(tab.logo)}" alt="">` : tabIcon(tab.icon);
    return `<div class="tab${active ? " is-active" : ""}" data-tab-id="${esc(tab.id)}">`
      + `<button type="button" class="tab-main" role="tab" aria-selected="${active}" data-tab-activate="${esc(tab.id)}" title="${esc(tab.label)}">`
      + `<span class="tab-icon">${visual}</span><span class="tab-label">${esc(tab.label)}</span></button>`
      + (tab.closable ? `<button type="button" class="tab-close" data-tab-close="${esc(tab.id)}" aria-label="ปิดแท็บ ${esc(tab.label)}" title="ปิดแท็บ">×</button>` : "")
      + `</div>`;
  }).join("");
  const activeEl = strip.querySelector(".tab.is-active");
  if (activeEl && typeof activeEl.scrollIntoView === "function") activeEl.scrollIntoView({ block: "nearest", inline: "nearest" });
  syncTabChrome();
}
/* ONE AI COMPOSER — บริบทแท็บ (owner 2026-10-18 ข้อ 5–7):
   #chatFrame ถูกโหลดครั้งเดียวและคงอยู่ตลอด session ⇒ กล่องข้อความกลางคือกล่องเดิมทุกแท็บ
   shell แจ้ง "หน้าจอที่กำลังเปิดอยู่" ให้กล่องนั้นทราบ (same-origin, ข้อความเดิมของ workspace)
   โดยไม่ส่งข้อมูลธุรกิจ/ไม่สร้างบริบทใหม่ และไม่ reload frame (ข้อความที่พิมพ์ค้างจึงไม่หาย) */
function postActiveScreen(tab){
  const frame = $("chatFrame");
  const win = frame?.contentWindow;
  if (!win) return;
  const kind = tab?.kind || "chat";
  try {
    win.postMessage({
      type: "dna-workspace-active-screen",
      kind,
      label: tab?.label || "Workspace",
      route: kind === "tool" ? tab?.url || "" : "/workspace",
      compact: kind !== "chat",
    }, location.origin);
  } catch { /* frame ยังไม่พร้อม — ส่งอีกครั้งตอน load/สลับแท็บ */ }
}
function applyTab(tab){
  const kind = tab?.kind || "chat";
  $("stockPane").hidden = kind !== "resource";
  $("toolPane").hidden = kind !== "tool";
  postActiveScreen(tab);
  /* แท็บแชต = หน้าจอเต็ม · แท็บอื่น = Composer ตัวเดิมย่อเป็นกล่องลอย (ไม่สร้างกล่อง/หน้าแชตใหม่) */
  $("homePane").hidden = false;
  document.body.classList.toggle("chat-compact", kind !== "chat");
  if (kind === "tool") {
    const frame = $("toolFrame");
    if (frame.getAttribute("src") !== tab.url) frame.setAttribute("src", tab.url);
    frame.title = `DNA OS — ${tab.label}`;
  }
  if (kind === "resource") render();
  renderTabs();
  if (typeof $("tabOverflowPanel") !== "undefined" && !$("tabOverflowPanel").hidden) renderTabMenu();
}
function activateTab(id, { record = true } = {}){
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  activeTabId = tab.id;
  if (record && navHistory[navIndex] !== tab.id) {
    navHistory = navHistory.slice(0, navIndex + 1);
    navHistory.push(tab.id);
    navIndex = navHistory.length - 1;
  }
  applyTab(tab);
}
function openTab(def, { record = true } = {}){
  const existing = tabs.find((t) => t.id === def.id);
  if (existing) { activateTab(existing.id, { record }); return existing }
  tabs = [...tabs, def];
  activateTab(def.id, { record });
  return def;
}
function closeTab(id){
  const tab = tabs.find((t) => t.id === id);
  if (!tab || !tab.closable) return;
  const index = tabs.findIndex((t) => t.id === id);
  tabs = tabs.filter((t) => t.id !== id);
  navHistory = navHistory.slice(0, navIndex + 1).filter((h) => h !== id);
  if (activeTabId === id) activeTabId = (tabs[Math.min(index, tabs.length - 1)] || tabs[0]).id;
  if (navHistory[navIndex] !== activeTabId) { navHistory.push(activeTabId); navIndex = navHistory.length - 1 }
  else navIndex = Math.min(navIndex, navHistory.length - 1);
  applyTab(currentTab());
}
function goBack(){
  if (navIndex === 0) return;
  const id = navHistory[navIndex - 1];
  if (!tabs.some((t) => t.id === id)) { navHistory = navHistory.filter((h) => h !== id); navIndex = Math.min(navIndex - 1, navHistory.length - 1); goBack(); return }
  navIndex -= 1;
  activeTabId = id;
  applyTab(currentTab());
}
function goForward(){
  if (navIndex >= navHistory.length - 1) return;
  const id = navHistory[navIndex + 1];
  if (!tabs.some((t) => t.id === id)) { navHistory = navHistory.filter((h) => h !== id); goForward(); return }
  navIndex += 1;
  activeTabId = id;
  applyTab(currentTab());
}
function openChatTab(){ activateTab(HOME_TAB.id) }
function openResourceTab(){ openTab({ id: "resources", label: "ศูนย์ควบคุมทรัพยากร", kind: "resource", icon: "stock", closable: true }) }
/* หน้าจอแชตย้ายมาอยู่ใน #chatFrame ที่โหลดค้างไว้แล้ว ⇒ ไม่ต้องตั้ง src ใหม่ (ไม่ให้ state หาย) */
function openWorkspaceSurface(next){ if (next === "chat") { openChatTab(); return } if (typeof window.openBusinessLauncher === "function") window.openBusinessLauncher() }
window.openWorkspaceSurface = openWorkspaceSurface;
$("add").onclick = () => openAction("create");
$("refresh").onclick = () => loadExistingMaterials();
$("search").oninput = render;
$("category").onchange = render;
$("controlForm").onsubmit = submitForm;
$("controlForm").onclick = (e) => { if (e.target.closest("[data-cancel]")) resetForm() };
$("cancelForm").onclick = resetForm;
document.querySelectorAll("[data-action]").forEach((b) => b.onclick = () => openAction(b.dataset.action));
$("back").onclick = goBack;
$("forward").onclick = goForward;
document.querySelectorAll("[data-view]").forEach((b) => b.onclick = () => { if (b.dataset.view === "all") openResourceTab() });
$("tabStrip").onclick = (e) => {
  const closeBtn = e.target.closest("[data-tab-close]");
  if (closeBtn) { closeTab(closeBtn.dataset.tabClose); return }
  const tabBtn = e.target.closest("[data-tab-activate]");
  if (tabBtn) activateTab(tabBtn.dataset.tabActivate);
};
$("tabStrip").onauxclick = (e) => {
  if (e.button !== 1) return;
  const el = e.target.closest("[data-tab-id]");
  if (!el) return;
  e.preventDefault();
  closeTab(el.dataset.tabId);
};
/* "+" = เปิดเครื่องมือเดิมเป็นแท็บ (ไม่สร้างเมนูชุดใหม่) */
function openNewTabChooser(){
  if (typeof window.openBusinessLauncher === "function") window.openBusinessLauncher();
}
$("newTab").onclick = openNewTabChooser;

/* ── จัดการแท็บและหน้าต่าง (⋯) + ค้นหา/URL (🔍) — owner 2026-10-18 ─────────────
   ทั้งสองปุ่มอยู่บน Tab Bar เท่านั้น (เดิม ⋯ อยู่ด้านขวาของพื้นที่กลาง)
   ใช้ state เดิมของ shell (tabs/activeTabId/openToolRoute/openExternalTool) ⇒ ไม่มีระบบแท็บชุดที่สอง
   และไม่สร้างหน้าเว็บ/หน้าแชตเลียนแบบ: URL จริงเปิดในเบราว์เซอร์ของผู้ใช้เท่านั้น (ไม่มี iframe) */
function tabVisual(tab){ return tab.logo ? `<img src="${esc(tab.logo)}" alt="">` : tabIcon(tab.icon) }
function syncTabBarState(){
  $("tabOverflow").setAttribute("aria-expanded", String(!$("tabOverflowPanel").hidden));
  $("tabSearch").setAttribute("aria-expanded", String(!$("tabSearchPanel").hidden));
}
function closeTabPanels(){ $("tabOverflowPanel").hidden = true; $("tabSearchPanel").hidden = true; syncTabBarState() }
function renderTabMenu(){
  $("tabMenuCount").textContent = `${tabs.length} แท็บ`;
  $("tabMenuList").innerHTML = tabs.map((tab) => `<div class="tab-menu-item${tab.id === activeTabId ? " is-active" : ""}">`
    + `<button type="button" role="menuitem" class="tab-menu-main" data-menu-activate="${esc(tab.id)}">`
    + `<span class="tab-icon">${tabVisual(tab)}</span><span class="tab-label">${esc(tab.label)}</span>`
    + (tab.id === activeTabId ? `<small>หน้าต่างปัจจุบัน</small>` : "")
    + `</button>`
    + (tab.closable ? `<button type="button" class="tab-menu-close" data-menu-close="${esc(tab.id)}" aria-label="ปิดแท็บ ${esc(tab.label)}" title="ปิดแท็บ">×</button>` : "")
    + `</div>`).join("");
  $("tabMenuCloseOthers").disabled = !tabs.some((t) => t.closable && t.id !== activeTabId);
  $("tabMenuCloseAll").disabled = !tabs.some((t) => t.closable);
}
function toggleTabMenu(){
  const panel = $("tabOverflowPanel"), willOpen = panel.hidden;
  closeTabPanels();
  if (!willOpen) return;
  renderTabMenu();
  panel.hidden = false;
  syncTabBarState();
}
$("tabOverflow").onclick = toggleTabMenu;
$("tabMenuList").onclick = (e) => {
  const closeBtn = e.target.closest("[data-menu-close]");
  if (closeBtn) { closeTab(closeBtn.dataset.menuClose); renderTabMenu(); return }
  const openBtn = e.target.closest("[data-menu-activate]");
  if (openBtn) { activateTab(openBtn.dataset.menuActivate); closeTabPanels(); }
};
$("tabMenuNew").onclick = () => { closeTabPanels(); openNewTabChooser() };
$("tabMenuCloseOthers").onclick = () => {
  for (const tab of [...tabs]) if (tab.closable && tab.id !== activeTabId) closeTab(tab.id);
  renderTabMenu();
};
$("tabMenuCloseAll").onclick = () => {
  for (const tab of [...tabs]) if (tab.closable) closeTab(tab.id);
  closeTabPanels();
};

/* ค้นหาบนแถบ: ค้นแท็บ/เครื่องมือที่เปิดได้จริง หรือวาง URL เพื่อเปิดเว็บไซต์ */
let searchRows = [];
function looksLikeUrl(value){ return /^https?:\/\/\S+$/i.test(value) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(value) }
function toUrl(value){ return /^https?:\/\//i.test(value) ? value : `https://${value}` }
function hostOf(value){ try { return new URL(toUrl(value)).host } catch { return value } }
function searchMatches(query){
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const rows = [];
  if (looksLikeUrl(query.trim())) rows.push({ kind: "site", url: toUrl(query.trim()), label: `เปิดเว็บไซต์ ${hostOf(query.trim())}`, detail: "เปิดในเบราว์เซอร์จริง" });
  for (const tab of tabs) if (tab.label.toLowerCase().includes(q)) rows.push({ kind: "tab", id: tab.id, label: tab.label, detail: tab.id === activeTabId ? "แท็บที่เปิดอยู่" : "สลับไปแท็บนี้", logo: tab.logo, icon: tab.icon });
  for (const tool of toolsCache || []) if (String(tool.label || "").toLowerCase().includes(q)) rows.push({ kind: "tool", value: tool.route || tool.external || "", external: !!tool.external, label: tool.label, detail: tool.external ? "เว็บไซต์ภายนอก" : "หน้าจอเดิม" });
  if (!looksLikeUrl(query.trim())) rows.push({ kind: "web", query: query.trim(), label: `ค้นหา “${query.trim()}” บนเว็บ`, detail: "เปิดในเบราว์เซอร์จริง" });
  return rows.slice(0, 24);
}
function renderTabSearch(){
  searchRows = searchMatches($("tabSearchInput").value);
  const list = $("tabSearchResults");
  if (!$("tabSearchInput").value.trim()) { list.innerHTML = `<p class="tab-pop-empty">พิมพ์ชื่อแท็บ/เครื่องมือ หรือวาง URL ของเว็บไซต์</p>`; return }
  list.innerHTML = searchRows.length ? searchRows.map((row, index) => `<button type="button" role="option" class="tab-pop-row" data-search-index="${index}">`
    + (row.kind === "tab" ? `<span class="tab-icon">${tabVisual(row)}</span>` : `<span class="tab-icon">${tabIcon(row.kind === "site" || row.kind === "web" ? "external" : "tools")}</span>`)
    + `<span class="tab-pop-copy"><strong>${esc(row.label)}</strong><small>${esc(row.detail)}</small></span></button>`).join("") : `<p class="tab-pop-empty">ไม่พบแท็บหรือเครื่องมือที่ตรงกัน</p>`;
}
function runSearchRow(row){
  if (!row) return;
  closeTabPanels();
  if (row.kind === "site") { void openExternalTool(row.url, hostOf(row.url)); return }
  if (row.kind === "tab") { activateTab(row.id); return }
  if (row.kind === "tool") { if (row.external) void openExternalTool(row.value, row.label); else openToolRoute(row.value, row.label); return }
  if (row.kind === "web") openInBrowser(`https://www.google.com/search?q=${encodeURIComponent(row.query)}`);
}
function toggleTabSearch(){
  const panel = $("tabSearchPanel"), willOpen = panel.hidden;
  closeTabPanels();
  if (!willOpen) return;
  panel.hidden = false;
  syncTabBarState();
  renderTabSearch();
  $("tabSearchInput").focus();
}
$("tabSearch").onclick = () => { void ensureTools().then(toggleTabSearch) };
$("tabSearchInput").oninput = renderTabSearch;
$("tabSearchResults").onclick = (e) => {
  const row = e.target.closest("[data-search-index]");
  if (row) runSearchRow(searchRows[Number(row.dataset.searchIndex)]);
};
$("tabSearchForm").onsubmit = (e) => {
  e.preventDefault();
  const value = $("tabSearchInput").value.trim();
  if (!value) return;
  if (looksLikeUrl(value)) { closeTabPanels(); void openExternalTool(toUrl(value), hostOf(value)); return }
  searchRows = searchMatches(value);
  runSearchRow(searchRows[0]);
};
document.addEventListener("click", (e) => {
  if (e.target.closest("#tabOverflowPanel,#tabOverflow,#tabSearchPanel,#tabSearch")) return;
  if (!$("tabOverflowPanel").hidden || !$("tabSearchPanel").hidden) closeTabPanels();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeTabPanels() });
syncTabBarState();
window.addEventListener("message", (e) => { if (e.origin === location.origin && e.data?.type === "dna-workspace-refresh-materials") loadExistingMaterials() });
activateTab(HOME_TAB.id, { record: false });
/* กล่องกลางอาจโหลดเสร็จทีหลัง — ส่งบริบทแท็บซ้ำเมื่อ frame พร้อม (ไม่ reload) */
$("chatFrame").addEventListener("load", () => postActiveScreen(currentTab()));
loadExistingMaterials();
/* ORG CONTEXT RELAY — shell นี้อยู่ระหว่างหน้า /workspace (ชั้นนอก) กับ iframe เครื่องมือ (ชั้นใน)
   ตัวเลือกองค์กรมีเจ้าของที่ชั้นนอกเพียงที่เดียว; ชั้นในอยู่ใน #toolFrame จึงไม่ได้รับ postMessage ตรง
   ⇒ ส่งต่อเฉพาะข้อความ org context ที่ shell นี้ไม่ตีความเอง (ไม่สร้าง state/navigation/ตัวเลือกใหม่) */
let lastOrgMessage=null;
window.addEventListener("message",e=>{if(e.origin!==location.origin)return;const t=e.data?.type;
/* โฟกัส/เบลอของกล่องพิมพ์จริงในหน้าแชต — ใช้คงความชัด/ขยายเฉพาะเท่าที่จำเป็นต่อการพิมพ์ */
if(t==="dna-chat-composer-active"){document.body.classList.toggle("chat-composer-active",e.data.active===true);return}
/* หน้าแชตเดิมขอเปิดเครื่องมือ/หน้าจอธุรกิจ → เปิดใน #toolFrame เดิม (หน้าแชตไม่ถูก navigate ทิ้ง ⇒
   ข้อความที่พิมพ์ค้างและ Composer ตัวเดิมคงอยู่) */
if(t==="dna-workspace-open-route"&&typeof e.data.route==="string"&&e.source===$("chatFrame")?.contentWindow){openToolRoute(e.data.route,typeof e.data.label==="string"?e.data.label:undefined);return}
if(t!=="dna-org-context"&&t!=="dna-org-context-request")return;
/* องค์กร: ชั้นนอก → shell → หน้าแชตเดิม (#chatFrame) และ #toolFrame (หน้าจอที่ถูกฝัง)
   เก็บค่าล่าสุดไว้ replay ให้ frame ที่เพิ่งโหลดเสร็จ/ขอใหม่ — กันข้อความประกาศที่มาถึงก่อน frame พร้อม
   (ยังคง authority ที่ชั้นนอกเท่านั้น — shell เป็นแค่ทางผ่าน/ทวนข้อความล่าสุด ไม่ตัดสินใจค่าองค์กรเอง) */
if(t==="dna-org-context")lastOrgMessage=e.data;
for(const el of [$("chatFrame"),$("toolFrame")]){const win=el?.contentWindow;if(!win)continue;if(e.source===parent){win.postMessage(e.data,location.origin)}else if(e.source===win){if(t==="dna-org-context-request"&&lastOrgMessage)win.postMessage(lastOrgMessage,location.origin);parent.postMessage(e.data,location.origin)}}});
/* BUSINESS TOOLS SEARCH — SINGLE SIDEBAR (owner 2026-10-20)
   ปุ่มเมนูเครื่องมือเดียว (#toolsMain) เปิด Business Launcher (business-tools.json เท่านั้น)
   ช่องค้นหาบนแถบใช้รายการธุรกิจชุดเดียวกัน — ไม่มี dialog เครื่องมือผู้พัฒนาและไม่มี tools.json ในผิวธุรกิจ */
let toolsCache=null;
async function ensureTools(){
  if(toolsCache)return toolsCache;
  try{
    const r=await fetch("business-tools.json",{cache:"no-store"});
    const d=r.ok?await r.json():null;
    toolsCache=(d?.groups||[]).flatMap(g=>(g.items||[]).map(it=>({label:it.label,route:it.route||"",external:it.external||""}))).filter(t=>t.route||t.external);
  }catch{toolsCache=[]}
  return toolsCache;
}
/* เปิด "หน้าจอ" ที่มีอยู่เดิมเป็นแท็บ — เส้นทางภายในใช้ #toolFrame เดิม (ไม่มี navigation ชุดที่สอง) */
function openToolRoute(route, label, visual){
  if (!route) return;
  openTab({
    id: `route:${route}`,
    label: label || "เครื่องมือ",
    kind: "tool",
    icon: visual?.icon || "tools",
    logo: visual?.logo,
    url: route,
    closable: true,
  });
}
/* แพลตฟอร์มภายนอก — เปิด Official URL ในเบราว์เซอร์ของผู้ใช้เท่านั้น (owner 2026-10-20)
   ไม่ฝัง iframe / ไม่มี Website Renderer / Remote Browser / ไม่ขอรหัสผ่านหรือคัดลอก Cookie
   และไม่ส่ง credential ใด ๆ เข้า Business AI — ข้อมูลบริการภายนอกเข้าผ่าน Connect Gateway เดิม */
function openInBrowser(url){
  if (window.parent && window.parent !== window) {
    window.parent.postMessage({ type: "dna-desktop-open-external", url }, location.origin);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
function openExternalTool(url, label){
  if (!url) return;
  openInBrowser(url);
  toast(`${label || "เว็บไซต์"} — เปิดในเบราว์เซอร์แล้ว`);
}
window.openToolRoute = openToolRoute;
window.openExternalTool = openExternalTool;
window.openInBrowser = openInBrowser;
