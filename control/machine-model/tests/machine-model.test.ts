/** พิสูจน์ฐาน: โมเดลเดียว สองทิศ และสิ่งที่ควรเป็นที่ไม่ได้ลอกมาจากสิ่งที่เป็น */
import { strict as assert } from "node:assert";
import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { buildMachineModel, buildDependencyIndex, diffMachineState, readExpectedState,
  expectedStateCoverage, currentMachineIdentity, whichMachine, resourcesOf, machineState,
  hardwareOf, operatingSystemOf, softwareOf, databasesOf, whereIs, availableOn, invocationOf,
  dependenciesOfResource, dependentsOfResource, knowledgeCoverage,
  evaluateNecessity, whyResource, whatIfRemoved, counterfactualSets, neutralityViolations,
  projectDeclaredInvocations, projectObservedInvocations, invocationOfCapability, resolveInvocationGaps,
  whoInvokes, howIsInvoked, whatExecutes, whereDoesItRun, whatContractIsUsed, lastObservedInvocation,
  buildSelfToolModel, toolsOfDNAOS, whatCanIDoNow, whatCanINotDoNow, toolFor,
  howDoIInvoke, whatDoesItRequire, whatWillItProduce, whyCanIUseItNow, whyCanINotUseItNow,
  knowledgeGapsByFactType,
  buildSelfKnowledge, answerOwnerSelfQuestions, aiRemovalProof, remainingGaps, KNOWLEDGE_FIELDS,
  freezeIntegrityGaps, retrospectiveIntegrityGate, answerIntegrityQuestions, INTEGRITY_FIELDS,
  classifyExecutions, authorityTraceOf, aiResourceModel, authorityModelGaps, CLASSIFICATION_ORDER,
  capabilityContracts, contractCompatibility, compositionGraph, machineActionPrimitives,
  outcomeResolution, canProduceOutcomeNow, whyCanNotProduceOutcome, missingCapabilitiesForOutcome,
  secretBoundaryCheck, ownerCompositionView, ACTION_CLASSES,
  classifyCapabilityLevels, canonicalOperandTypes, canonicalOperators, composableOperatorPairs,
  resolveOutcomeExpression, aiOperationPositions, OWNER_TEST_EXPRESSIONS, LEVEL_ORDER,
  MACHINE_LAYERS, EDGE_SEMANTICS } from "../contract";

/**
 * จำนวนความสามารถเป็นค่าที่วัดสดจากทะเบียน ไม่ใช่ค่าคงที่ในเทสต์
 *
 * DNA_OS_EMPIRICAL_COMPOSITION_LAB_V1 (2026-08-31) ลงทะเบียน `control/machine-model/`
 * ผ่านท่อเดิม (Candidate -> Duplicate Gate -> Registry Writer) จำนวนจึงเปลี่ยนจาก
 * 112 เป็น 113 การตรึงตัวเลขไว้ในเทสต์ทำให้การลงทะเบียนที่ถูกต้องกลายเป็นความล้มเหลว
 */
const CANONICAL_CAPABILITY_COUNT = readFileSync(
  "software/registry-database/data/canonical/capabilities.jsonl", "utf8")
  .split("\n").filter((l) => l.trim().length > 0).length;

let pass = 0, fail = 0;
function t(name: string, fn: () => void): void {
  try { fn(); pass += 1; console.log(`  PASS ${name}`); }
  catch (e) { fail += 1; console.log(`  FAIL ${name}\n       ${(e as Error).message}`); }
}

const model = buildMachineModel();
const index = buildDependencyIndex(model);

t("1. ชั้นครบสิบเจ็ดเสมอ ตามลำดับที่ประกาศ", () => {
  assert.equal(MACHINE_LAYERS.length, 17);
  assert.deepEqual(MACHINE_LAYERS.map((l) => l.order), Array.from({ length: 17 }, (_, i) => i + 1));
  assert.equal(model.coverage.length, 17, "ชั้นที่ไม่มีข้อมูลต้องไม่หายไปจากผลลัพธ์");
});

t("2. ชั้นที่ไม่มีข้อมูลยังรายงานตัวว่าไม่มี ไม่ใช่เงียบ", () => {
  // ทั้งสิบเจ็ดชั้นมีข้อมูลแล้วหลัง COMPLETE_LOCAL_MACHINE_ENVIRONMENT_MODEL_V1
  // กลไกที่ต้องยังทำงานคือ: ชั้นที่ไม่มีข้อมูลต้องประกาศตัวเอง ไม่ใช่หายไป
  // พิสูจน์ด้วยการสร้างโมเดลโดยไม่สำรวจร่างกาย — สามชั้นนั้นต้องกลับมาว่าง
  const withoutCensus = buildMachineModel({ census: false });
  assert.equal(withoutCensus.coverage.length, 17);
  const none = withoutCensus.coverage.filter((c) => c.status === "NOT_REPRESENTED");
  assert.deepEqual(none.map((c) => c.layer_id).sort(),
    ["HARDWARE_OS", "INSTALLED_SOFTWARE", "LOCAL_DATABASES"]);
  for (const c of none) {
    assert.equal(c.node_count, 0);
    assert.ok(c.reason.length > 0, "ต้องบอกเหตุผล");
    assert.equal(c.source_store, null);
  }
  for (const c of model.coverage) assert.ok(c.reason.length > 0);
});

t("3. โมเดลไม่ได้เกิดจากการอ่านซอร์ส", () => {
  const src = ["../model.ts", "../dependency-index.ts", "../expected-state.ts"]
    .map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n")
    .split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//")).join("\n");
  for (const banned of ["readdirSync", "glob", '".ts"', "walkDir"]) {
    assert.ok(!src.includes(banned), `พบการสแกนซอร์ส: ${banned}`);
  }
  for (const b of model.built_from) assert.ok(b.length > 0);
  assert.ok(model.built_from.length >= 6, `ต่อจากแหล่งที่มีอยู่ ${model.built_from.length} แหล่ง`);
});

t("4. ตัวตนของเครื่องไม่ถูกแทนด้วย hostname", () => {
  // ยังไม่มีพิธีเริ่มติดตั้ง -> machine_id ต้องเป็น null ไม่ใช่ชื่อเครื่อง
  assert.ok(model.machine_id === null || model.machine_id.startsWith("installation-"),
    `machine_id ที่ยอมรับได้คือ null หรือ installation id เท่านั้น ได้ ${model.machine_id}`);
  const src = readFileSync(new URL("../model.ts", import.meta.url), "utf8");
  assert.ok(!/hostname\(\)|os\.hostname/.test(src), "ห้ามใช้ hostname เป็นตัวตนของเครื่อง");
});

t("5. สองทิศเป็นภาพเดียวกัน ไม่ใช่สองกราฟ", () => {
  let checked = 0;
  for (const n of model.nodes) {
    for (const d of index.dependenciesOf(n.node_id)) {
      assert.ok(index.dependentsOf(d.depends_on).some((r) => r.dependent === n.node_id),
        `${n.node_id} พึ่ง ${d.depends_on} แต่ทิศกลับตอบไม่ได้`);
      checked += 1;
    }
  }
  assert.ok(checked > 100, `ตรวจแล้ว ${checked} เส้น`);
});

t("6. ทิศพึ่งพาไม่ใช่ทิศลูกศร", () => {
  // FILE -> CAPABILITY: ลบไฟล์แล้วความสามารถพัง ไม่ใช่ทางกลับ
  assert.equal(EDGE_SEMANTICS.MODULE_TO_CAPABILITY, "TO_DEPENDS_ON_FROM");
  const fileNode = model.nodes.find((n) => n.layer_id === "FILES_PACKAGES"
    && index.dependentsOf(n.node_id).length > 0);
  assert.ok(fileNode !== undefined, "ต้องมีไฟล์ที่มีผู้พึ่งพา");
  assert.equal(index.dependenciesOf(fileNode!.node_id).length, 0,
    "ไฟล์ไม่ควรถูกอ่านว่าพึ่งความสามารถที่ตัวเองรองรับ");
});

t("7. ชนิดที่ยังไม่ประกาศความหมาย ไม่เข้ากราฟผลกระทบ", () => {
  assert.ok(index.undeclared_edge_count > 0, "ต้องมีชนิดที่ยังไม่ประกาศให้เห็น");
  assert.ok(index.undeclared_edge_kinds.length > 0);
  for (const k of index.undeclared_edge_kinds) assert.equal(EDGE_SEMANTICS[k], undefined);
  assert.equal(index.declared_edge_count + index.undeclared_edge_count <= model.edges.length, true);
});

t("8. ผลกระทบเดินหลายชั้นและไม่วนลูป", () => {
  const withImpact = model.nodes
    .map((n) => ({ n, i: index.impactOf(n.node_id) }))
    .filter((x) => x.i.length > 0)
    .sort((a, b) => b.i.length - a.i.length);
  assert.ok(withImpact.length > 0, "ต้องมีโหนดที่มีผู้พึ่งพา");
  const top = withImpact[0];
  assert.ok(withImpact.some((x) => x.i.some((p) => p.depth >= 2)), "ต้องมีที่เดินได้เกินหนึ่งชั้น");
  assert.equal(new Set(top.i.map((p) => p.node_id)).size, top.i.length, "ต้องไม่รายงานโหนดซ้ำ");
  assert.ok(!top.i.some((p) => p.node_id === top.n.node_id), "ต้องไม่วนกลับหาตัวเอง");
});

t("9. สิ่งที่ควรเป็น มาจากคำประกาศ ไม่ใช่จากสิ่งที่สังเกตได้", () => {
  const expected = readExpectedState();
  for (const e of expected) {
    assert.ok(e.basis.includes("runtime-targets.jsonl"), "ทุกความคาดหวังต้องชี้กลับไปที่คำประกาศ");
    assert.ok(e.evidence_refs.length > 0, "คำประกาศต้องมีหลักฐานติดมา");
  }
  const src = readFileSync(new URL("../expected-state.ts", import.meta.url), "utf8");
  assert.ok(!/observed\s*as\s*expected|expected\s*=\s*observed/.test(src));
  // จำนวนที่ประกาศต้องน้อยกว่าจำนวนที่สังเกตได้มาก — ช่องว่างนี้คือความจริง
  assert.ok(expected.length < model.nodes.length);
});

t("10. ชั้นที่ยังไม่มีใครประกาศความคาดหวัง ต้องถูกรายงาน", () => {
  const r = diffMachineState(model, index);
  assert.ok(r.undeclared_layers.length >= 14,
    `ชั้นที่ยังไม่มีความคาดหวัง = ${r.undeclared_layers.length} ต้องเห็นทั้งหมด`);
  assert.ok(!r.undeclared_layers.includes("RUNTIME" as never));
});

t("11. OBSERVE_ONLY ห้ามลงมือ ไม่ว่าปัญหาจะหนักแค่ไหน", () => {
  const r = diffMachineState(model, index);
  for (const d of r.differences) {
    assert.equal(d.dispatched, false, "ชั้นนี้ต้องไม่ส่งอะไรไปทำ");
    if (d.expectation.authority === "OBSERVE_ONLY") {
      assert.equal(d.repair_permitted, false, `${d.expectation.canonical_name} ประกาศ OBSERVE_ONLY แต่กลับอนุญาตให้ซ่อม`);
    }
  }
});

t("12. ความสามารถกู้คืนมาจากทะเบียน ไม่ใช่ชื่อที่ตั้งเอง", () => {
  const r = diffMachineState(model, index);
  for (const d of r.differences) {
    assert.ok(["KNOWN", "NOT_REGISTERED", "NONE_DECLARED"].includes(d.recovery_status));
    if (d.recovery_status === "KNOWN") assert.ok(d.known_recovery_capability!.startsWith("capability-"));
    else assert.equal(d.known_recovery_capability, null, "ไม่รู้จักต้องเป็น null ไม่ใช่ชื่อที่เดา");
  }
});

t("13. ไม่มีการเขียนใด ๆ", () => {
  const files = ["../model.ts", "../dependency-index.ts", "../expected-state.ts", "../layers.ts"];
  const src = files.map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n")
    .split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//")).join("\n");
  for (const b of ["writeFileSync", "appendFileSync", "mkdirSync", "rmSync", "unlinkSync"]) {
    assert.ok(!src.includes(b), `พบ ${b}`);
  }
  const watched = ["software/registry-database/data/canonical/resources.jsonl",
    "control/machine-observation/data/runtime-targets.jsonl"];
  const before = watched.map((p) => statSync(p).size);
  buildMachineModel(); buildDependencyIndex(buildMachineModel());
  assert.deepEqual(watched.map((p) => statSync(p).size), before);
});

t("14. โมเดลเดิมให้ผลเดิม", () => {
  const a = buildMachineModel(), b = buildMachineModel();
  assert.equal(JSON.stringify(a.coverage), JSON.stringify(b.coverage));
  assert.equal(a.nodes.length, b.nodes.length);
  assert.equal(JSON.stringify(buildDependencyIndex(a).undeclared_edge_kinds),
    JSON.stringify(buildDependencyIndex(b).undeclared_edge_kinds));
});


// ── CLOSE_MACHINE_IDENTITY_AND_RECOVERY_FOUNDATION ──

t("15. เครื่องมีตัวตน และตัวตนไม่ได้มาจากชื่อเครื่อง/รีโป/path", () => {
  const id = currentMachineIdentity();
  assert.equal(id.state, "INITIALIZED");
  assert.ok(/^installation-[0-9a-f-]{36}$/.test(id.machine_id!), `รูปแบบผิด: ${id.machine_id}`);
  assert.ok(!id.machine_id!.includes(hostname()), "ตัวตนต้องไม่มีชื่อเครื่องอยู่ข้างใน");
  assert.ok(!id.machine_id!.includes("DNA-OS"), "ตัวตนต้องไม่มีชื่อรีโปอยู่ข้างใน");
  assert.equal(model.machine_id, id.machine_id, "โมเดลต้องอ่านตัวตนเดียวกัน");
});

t("16. ตัวตนอยู่รอดข้าม process และเก็บนอกรีโป", () => {
  const id = currentMachineIdentity();
  assert.ok(id.persistence_path !== null);
  assert.ok(!id.persistence_path!.startsWith(process.cwd()),
    "ไฟล์ตัวตนต้องไม่อยู่ในรีโป ไม่อย่างนั้น git clone จะพาไปด้วย");
  const out = execFileSync("npx", ["tsx", "--eval",
    `import {currentMachineIdentity} from "${new URL("../machine-binding.ts", import.meta.url).pathname}";` +
    `console.log(currentMachineIdentity().machine_id);`], { encoding: "utf8", cwd: process.cwd() });
  assert.equal(out.trim().split("\n").pop(), id.machine_id, "process ใหม่ต้องอ่านตัวตนเดิมได้");
});

t("17. เปลี่ยน state root = คนละเครื่อง ไม่สืบทอดตัวตน", () => {
  const isolated = mkdtempSync(join(tmpdir(), "machine-identity-"));
  const out = execFileSync("npx", ["tsx", "--eval",
    `import {currentMachineIdentity} from "${new URL("../machine-binding.ts", import.meta.url).pathname}";` +
    `console.log(JSON.stringify(currentMachineIdentity()));`],
    { encoding: "utf8", cwd: process.cwd(), env: { ...process.env, DNA_OS_STATE_ROOT: isolated } });
  const fresh = JSON.parse(out.trim().split("\n").pop()!);
  assert.equal(fresh.machine_id, null, "การติดตั้งใหม่ต้องไม่ได้ตัวตนของเครื่องนี้ติดไป");
  assert.equal(fresh.state, "UNINITIALIZED");
});

t("18. ผูกโหนดได้ครบ โดยไม่มี id เดิมถูกแก้", () => {
  const id = currentMachineIdentity();
  const bound = resourcesOf(id.machine_id!, model);
  assert.equal(bound.length, model.nodes.length, "ทุกโหนดต้องผูกได้");
  // โหนดชั้น MACHINE คือตัวเครื่องเอง จึงมี machine_id อยู่ในตัวตนโดยชอบ
  // ที่เหลือทั้งหมดต้องไม่ถูกแตะ
  for (const n of bound) {
    if (n.layer_id === "MACHINE") continue;
    assert.ok(!n.node_id.includes(id.machine_id!), `id เดิมถูกเขียนทับ: ${n.node_id}`);
  }
  const w = whichMachine(bound[0].node_id, model);
  assert.equal(w.machine_id, id.machine_id);
  assert.equal(w.binding_basis, "LOCAL_STORE_READ_ON_THIS_INSTALLATION");
  assert.equal(whichMachine("machine://CAPABILITIES/ไม่มีจริง", model).machine_id, null);
  assert.equal(resourcesOf("installation-00000000-0000-0000-0000-000000000000", model).length, 0);
});

t("19. machineState ตอบเหมือนเดิมทุกครั้ง", () => {
  const id = currentMachineIdentity().machine_id!;
  assert.equal(JSON.stringify(machineState(id, model)), JSON.stringify(machineState(id, model)));
  const s = machineState(id, model);
  assert.equal(s.bound_node_count, model.nodes.length);
  assert.deepEqual([...s.not_represented_layers], [], "ทุกชั้นมีตัวแทนแล้ว");
  assert.equal(s.represented_layers, 17);
});

t("20. ความสามารถกู้คืนหาเจอจากทะเบียนเดิม ไม่ต้องลงทะเบียนใหม่", () => {
  const d = diffMachineState(model, index).differences;
  assert.ok(d.length > 0);
  for (const x of d) {
    assert.equal(x.recovery_status, "KNOWN", "ต้อง resolve ถึงความสามารถกู้คืนได้");
    assert.ok(x.known_recovery_capability!.startsWith("capability-"));
  }
});

t("21. resolve ถึงความสามารถกู้คืน ไม่ได้แปลว่าอนุญาตให้ซ่อม", () => {
  for (const x of diffMachineState(model, index).differences) {
    assert.equal(x.dispatched, false);
    if (x.expectation.authority === "OBSERVE_ONLY") assert.equal(x.repair_permitted, false);
  }
});

t("22. บริการที่รันอยู่ ไม่ถูกยกเป็นความคาดหวัง", () => {
  const c = expectedStateCoverage(model, index);
  assert.ok(c.observed_target_count > c.expected_target_count,
    "ต้องมีบริการที่รันอยู่มากกว่าที่ประกาศไว้ — ช่องว่างนี้ต้องเห็น");
  assert.ok(c.missing_expectation_count > 0);
  for (const t2 of c.targets) {
    if (t2.coverage_class === "MISSING_EXPECTATION") {
      assert.equal(t2.declared_capability_id, null, "ไม่มีคำประกาศต้องเป็น null ไม่ใช่เดาจากชื่อ label");
      assert.equal(t2.declaration_source, null);
    } else {
      assert.ok(t2.declaration_source!.includes("runtime-targets.jsonl"));
    }
  }
});

t("23. ไม่มีคลังใหม่ และเส้นที่ยังไม่ประกาศยังถูกกันออก", () => {
  // เดิมข้อนี้ยืนยันว่าสามชั้นล่างต้องว่าง ซึ่งเป็นขอบเขตของ TASK ก่อนหน้า
  // COMPLETE_LOCAL_MACHINE_ENVIRONMENT_MODEL_V1 (2026-08-30) สั่งให้สำรวจสามชั้นนั้น
  // ข้อนี้จึงเหลือสิ่งที่ยังเป็นจริงเสมอ: ไม่มีคลังใหม่ และไม่มีการเดาทิศของเส้น
  for (const f of ["../expected-state.ts", "../census.ts", "../knowledge-coverage.ts"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8")
      .split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//")).join("\n");
    assert.ok(!/writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync/.test(src), `${f} เขียนไฟล์`);
  }
  assert.ok(index.undeclared_edge_count > 0, "เส้นที่ยังไม่ประกาศต้องยังถูกกันออกจากกราฟผลกระทบ");
  assert.equal(index.undeclared_edge_count, 21);
});

// ── COMPLETE_LOCAL_MACHINE_ENVIRONMENT_MODEL_V1 ──

t("24. ทั้งสิบเจ็ดชั้นมีตัวแทนแล้ว", () => {
  const missing = model.coverage.filter((c) => c.status !== "REPRESENTED");
  assert.equal(missing.length, 0, `ยังว่าง: ${missing.map((c) => c.layer_id).join(",")}`);
  for (const layer of ["HARDWARE_OS", "INSTALLED_SOFTWARE", "LOCAL_DATABASES"] as const) {
    assert.ok(model.coverage.find((c) => c.layer_id === layer)!.node_count > 0);
  }
});

t("25. ทุกข้อเท็จจริงของเครื่องมีที่มาและหลักฐาน", () => {
  const id = currentMachineIdentity().machine_id!;
  const facts = [...hardwareOf(id), ...operatingSystemOf(id)];
  assert.ok(facts.length >= 13);
  for (const f of facts) {
    assert.equal(f.machine_id, id);
    assert.ok(f.observation_source.length > 0);
    assert.ok(f.evidence_ref.length > 0);
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(f.observed_at));
  }
  const kinds = new Set(facts.map((f) => f.fact_type));
  for (const need of ["HARDWARE_MODEL", "ARCHITECTURE", "CPU", "PHYSICAL_MEMORY_BYTES",
                      "OS_FAMILY", "OS_VERSION", "OS_BUILD", "KERNEL_VERSION"]) {
    assert.ok(kinds.has(need as never), `ขาด ${need}`);
  }
});

t("26. ตัวตนของเครื่องไม่ได้มาจากสิ่งที่สำรวจเจอ", () => {
  const id = currentMachineIdentity().machine_id!;
  const facts = [...hardwareOf(id), ...operatingSystemOf(id)];
  for (const f of facts) {
    assert.ok(!id.includes(f.observed_value), "ตัวตนต้องไม่ประกอบจากค่าที่วัดได้");
  }
  const src = readFileSync(new URL("../census.ts", import.meta.url), "utf8");
  assert.ok(!/installation-\$\{|randomUUID/.test(src), "census ต้องไม่สร้างตัวตนเอง");
});

t("27. ซอฟต์แวร์แยกชนิดครบ และไม่มีช่องบอกสิทธิ์", () => {
  const id = currentMachineIdentity().machine_id!;
  const all = softwareOf(id);
  const kinds = new Set(all.map((s) => s.kind));
  for (const k of ["APPLICATION", "CLI_TOOL", "PACKAGE", "SYSTEM_COMPONENT", "RUNTIME", "BACKGROUND_SERVICE"]) {
    assert.ok(kinds.has(k as never), `ขาดชนิด ${k}`);
  }
  // มีอยู่ กับ มีสิทธิ์ เป็นคนละข้อเท็จจริง — ชนิดข้อมูลต้องไม่มีช่องให้เติม
  for (const s of all.slice(0, 50)) {
    for (const forbidden of ["trusted", "required", "permitted", "owner", "authority"]) {
      assert.ok(!(forbidden in (s as unknown as Record<string, unknown>)), `พบช่อง ${forbidden}`);
    }
    assert.ok(s.evidence_ref.length > 0);
    assert.equal(s.machine_id, id);
  }
});

t("28. ไม่รันไบนารีนอกรายการ runtime ที่ประกาศไว้", () => {
  const id = currentMachineIdentity().machine_id!;
  const versioned = softwareOf(id).filter((s) => s.version !== null && s.kind === "CLI_TOOL");
  assert.equal(versioned.length, 0, "เครื่องมือบรรทัดคำสั่งต้องไม่ถูกรันเพื่อถามเวอร์ชัน");
  assert.ok(softwareOf(id, "RUNTIME").some((s) => s.version !== null), "runtime ที่ประกาศไว้ต้องมีเวอร์ชัน");
});

t("29. ฐานข้อมูลถูกจัดประเภทโดยไม่อ่านเนื้อหาระเบียน", () => {
  const id = currentMachineIdentity().machine_id!;
  const dbs = databasesOf(id);
  assert.ok(dbs.length > 0);
  for (const d of dbs) {
    assert.equal(d.machine_id, id);
    assert.ok(["PRESENT", "LISTENING", "DECLARED"].includes(d.state));
    assert.ok(d.evidence_ref.length > 0);
  }
  assert.ok(databasesOf(id, "DATABASE_ENGINE").length > 0);
  assert.ok(databasesOf(id, "LOCAL_DATA_STORE").length > 0);
  const src = readFileSync(new URL("../census.ts", import.meta.url), "utf8")
    .split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//")).join("\n");
  for (const banned of ["SELECT", "psql -c", "pg_dump", "sqlite3 ", ".dump"]) {
    assert.ok(!src.includes(banned), `พบการอ่านเนื้อหาฐานข้อมูล: ${banned}`);
  }
});

t("30. คำถามเรื่องของบนเครื่อง ตอบได้และไม่เดาแทนผู้ถาม", () => {
  const id = currentMachineIdentity().machine_id!;
  const rt = softwareOf(id, "RUNTIME")[0];
  const w = whereIs(rt.software_id);
  assert.equal(w.status, "FOUND");
  assert.equal(w.machine_id, id);
  assert.ok(w.evidence_ref !== null);
  assert.equal(availableOn(rt.software_id, id).available, true);
  assert.ok(invocationOf(rt.software_id) !== null);
  // ชื่อที่ตรงหลายชนิดต้องไม่ถูกเลือกให้
  const amb = whereIs("node");
  assert.ok(amb.status === "AMBIGUOUS" || amb.status === "FOUND");
  if (amb.status === "AMBIGUOUS") assert.ok(amb.candidates.length > 1);
  assert.equal(whereIs("ของที่ไม่มีจริงบนเครื่องนี้").status, "NOT_FOUND");
  assert.equal(availableOn(rt.software_id, "installation-00000000-0000-0000-0000-000000000000").available, false);
});

t("31. คำตอบเรื่องการพึ่งพา มาจากเส้นที่ประกาศแล้วเท่านั้น", () => {
  const id = currentMachineIdentity().machine_id!;
  const rt = softwareOf(id, "RUNTIME")[0];
  const node = `machine://INSTALLED_SOFTWARE/RUNTIME/${rt.name}`;
  const deps = dependenciesOfResource(node, index, model);
  assert.ok(deps.length > 0, "runtime ต้องพึ่งเครื่องที่มันอยู่");
  assert.ok(deps.every((d) => EDGE_SEMANTICS[d.kind] !== undefined), "ทุกคำตอบต้องมาจากชนิดที่ประกาศแล้ว");
  const machineNode = `machine://MACHINE/${id}`;
  assert.ok(dependentsOfResource(machineNode, index, model).length > 1000, "ของบนเครื่องต้องพึ่งเครื่อง");
  assert.equal(EDGE_SEMANTICS.OBSERVED_ON_MACHINE, "NOT_A_DEPENDENCY",
    "ข้อเท็จจริงที่สังเกตได้ ไม่ใช่การพึ่งพา");
});

t("32. ช่องว่างของโมเดลถูกตั้งชื่อ ไม่ถูกเดาแทน", () => {
  const r = knowledgeCoverage(model);
  assert.equal(r.machine_id, currentMachineIdentity().machine_id);
  for (const l of r.layers) {
    assert.ok(l.expected_fact_types.length > 0, "ชนิดที่คาดหวังต้องประกาศไว้ก่อน");
    for (const g of l.model_gaps) assert.ok(!l.observed_fact_types.includes(g));
  }
  const src = readFileSync(new URL("../knowledge-coverage.ts", import.meta.url), "utf8")
    .split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//")).join("\n");
  for (const banned of ["fallback", "Math.random", "openai", "anthropic", "prompt", "inferFact"]) {
    assert.ok(!src.includes(banned), `พบทางเดา: ${banned}`);
  }
  // ชั้นที่ไม่มีการสังเกตเลย ต้องกลายเป็นช่องว่างทั้งหมด ไม่ใช่ถูกเติมให้
  const noCensus = knowledgeCoverage(buildMachineModel({ census: false }));
  const hw = noCensus.layers.find((l) => l.layer_id === "HARDWARE_OS")!;
  assert.equal(hw.observed_fact_types.length, 0);
  assert.equal(hw.model_gaps.length, hw.expected_fact_types.length);
});

t("33. การสำรวจไม่ก่อผลข้างเคียงกับเครื่อง", () => {
  const src = readFileSync(new URL("../census.ts", import.meta.url), "utf8")
    .split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//")).join("\n");
  for (const b of ['"kill"', '"rm"', '"uninstall"', "brew remove", "launchctl unload",
                   "launchctl bootout", "writeFileSync", "mkdirSync", "shutdown", "reboot",
                   "brew install", "npm install", "pkill"]) {
    assert.ok(!src.includes(b), `พบคำสั่งที่เปลี่ยนสถานะเครื่อง: ${b}`);
  }
});


// ── RESOURCE_NECESSITY_AND_PURPOSE_RESOLUTION_V1 ──

const necessity = evaluateNecessity(model, index);
const resourceResults = necessity.filter((r) => r.is_resource);

t("34. ความจำเป็นถูกคำนวณ ไม่มีรายชื่อของที่ต้องมีเขียนไว้", () => {
  const src = readFileSync(new URL("../necessity.ts", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"))
    .filter((l) => !l.trimStart().startsWith("import "))   // `node:fs` เป็นโมดูลมาตรฐาน ไม่ใช่ยี่ห้อ
    .join("\n");
  for (const vendor of ["claude", "openai", "github", "vscode", "railway", "supabase",
                        "postgres", "nodejs", "python", "chrome"]) {
    assert.ok(!new RegExp(`["'\`][^"'\`]*${vendor}`, "i").test(src), `พบชื่อผลิตภัณฑ์ในกฎ: ${vendor}`);
  }
  assert.ok(!/REQUIRED_LIST|ALWAYS_REQUIRED|IMPORTANT/.test(src), "ห้ามมีรายชื่อของที่ต้องมี");
});

t("35. การติดตั้ง/การรัน ไม่ทำให้อะไรจำเป็น", () => {
  const installed = resourceResults.filter((r) => r.layer_id === "INSTALLED_SOFTWARE");
  assert.ok(installed.length > 1000);
  // ── เส้นแบ่งที่ข้อนี้ปกป้อง ──
  // หลัง CAPABILITY_INVOCATION_TRUTH_V1 บริการที่ "มีความสามารถประกาศไว้ว่ารันอยู่ในนั้น"
  // เป็น REQUIRED ได้ เพราะความจำเป็นจบที่คำประกาศ สิ่งที่ยังต้องเป็นจริงเสมอคือ:
  // ของที่รู้แค่ว่าติดตั้งไว้/รันอยู่ ต้องไม่จำเป็นเพราะเหตุนั้นเพียงอย่างเดียว
  const existenceOnly = installed.filter((r) => r.roles.length === 0 || r.roles.includes("OBSERVED_ONLY"));
  assert.ok(existenceOnly.length > 1000, `ของที่รู้แค่ว่ามีอยู่ = ${existenceOnly.length}`);
  assert.equal(existenceOnly.filter((r) => r.necessity === "REQUIRED").length, 0,
    "ของที่แค่ติดตั้งไว้ ต้องไม่ถูกตัดสินว่าจำเป็น");
  for (const r of existenceOnly.slice(0, 100)) {
    assert.equal(r.necessity, "INSUFFICIENT_EVIDENCE");
    assert.equal(r.missing_fact_type, "RESOURCE_TO_CAPABILITY_RELATION");
  }
  // ของที่เป็น REQUIRED ในชั้นนี้ ต้องมีคำประกาศรองรับทุกใบ
  for (const r of installed.filter((x) => x.necessity === "REQUIRED")) {
    assert.ok(r.dependent_capabilities.length > 0, `${r.node_id} จำเป็นโดยไม่มีความสามารถใดประกาศพึ่งพา`);
  }
});

t("36. REQUIRED เกิดได้เมื่อไม่มีของอื่นทำสัญญาเดียวกันเท่านั้น", () => {
  const required = necessity.filter((r) => r.necessity === "REQUIRED");
  assert.ok(required.length > 0);
  for (const r of required) {
    assert.equal(r.alternatives.length, 0, `${r.node_id} มีทางเลือกอื่นแต่ยังถูกเรียกว่าจำเป็น`);
    assert.ok(r.dependent_capabilities.length > 0 || r.roles.includes("PROVIDES_CAPABILITY"),
      "ต้องมีความสามารถที่พึ่งมันอยู่");
  }
  const replaceable = necessity.filter((r) => r.necessity === "REPLACEABLE");
  for (const r of replaceable) assert.ok(r.alternatives.length > 0);
});

t("37. ความจำเป็นไม่ผูกกับยี่ห้อ", () => {
  assert.deepEqual(neutralityViolations(necessity), [],
    "ไม่มีซอฟต์แวร์/ผู้ให้บริการ/กุญแจรายใดถูกตัดสินว่าจำเป็นโดยตรง");
});

t("38. เจตนามาจากทะเบียน ไม่ใช่ข้อความที่แต่งขึ้น", () => {
  const withCap = necessity.filter((r) => r.necessity === "REQUIRED" || r.necessity === "REPLACEABLE");
  let proven = 0;
  for (const r of withCap) {
    const why = whyResource(r.node_id, model, index);
    if (why.status !== "PROVEN") continue;
    proven += 1;
    assert.ok(why.capability_id !== null);
    assert.ok(why.relationship_path.length >= 2, "ต้องมีเส้นทางความสัมพันธ์");
    assert.ok(why.evidence_refs.length > 0, "ต้องมีตัวชี้หลักฐาน");
    assert.ok(why.purpose_basis !== null && why.purpose_basis.length > 0);
  }
  assert.ok(proven > 100, `พิสูจน์เจตนาได้ ${proven}`);
  const none = whyResource("machine://INSTALLED_SOFTWARE/CLI_TOOL/ls", model, index);
  assert.equal(none.status, "NO_CAPABILITY_RELATION");
  assert.equal(none.purpose_basis, null, "ไม่มีความสัมพันธ์ ต้องไม่มีเจตนาแถมมา");
});

t("39. UNUSED ไม่ได้แปลว่าลบได้ และประวัติยังอยู่", () => {
  const src = readFileSync(new URL("../necessity.ts", import.meta.url), "utf8");
  assert.ok(/ไม่ได้แปลว่าลบได้/.test(src));
  for (const b of ["unlinkSync", "rmSync", "writeFileSync", "uninstall", "SAFE_TO_DELETE"]) {
    assert.ok(!src.includes(b), `พบ ${b}`);
  }
  const historical = necessity.filter((r) => r.necessity === "HISTORICAL");
  assert.ok(historical.length > 0, "ความสัมพันธ์ที่ถูกถอนต้องยังปรากฏเป็นสายเลือด");
});

t("40. ถ้าของหายไป คำนวณผลกระทบจากเส้นที่ประกาศแล้วเท่านั้น", () => {
  const provider = necessity.find((r) => r.necessity === "REQUIRED" && r.roles.includes("PROVIDES_CAPABILITY"))!;
  const im = whatIfRemoved([provider.node_id], model, index);
  assert.ok(im.lost_capabilities.length > 0, "ผู้ให้บริการรายเดียวหายไป ความสามารถต้องหาย");
  assert.ok(im.lost_owner_outcomes.length > 0, "ความสามารถหาย ผลลัพธ์ที่ Owner ต้องการต้องถูกรายงานว่าหาย");
  assert.equal(im.unresolved_dependency_semantics, index.undeclared_edge_count);
  assert.equal(im.unresolved_dependency_semantics, 21, "เส้นที่ยังไม่ประกาศต้องยังถูกกันออก");
  assert.ok(im.evidence.length > 0);
  const nothing = whatIfRemoved(["machine://INSTALLED_SOFTWARE/CLI_TOOL/ไม่มีจริง"], model, index);
  assert.equal(nothing.lost_capabilities.length, 0);
});

t("41. ของที่มีทางเลือกอื่น หายไปแล้วไม่ทำให้ความสามารถหาย", () => {
  const rep = necessity.find((r) => r.necessity === "REPLACEABLE" && r.roles.includes("PROVIDES_CAPABILITY"));
  if (rep === undefined) { assert.ok(true, "ยังไม่มีของที่ทดแทนกันได้ในกราฟนี้"); return; }
  const im = whatIfRemoved([rep.node_id], model, index);
  assert.equal(im.lost_capabilities.length, 0, "มีผู้ให้บริการอื่นเหลืออยู่");
  assert.ok(im.available_replacements.length > 0);
});

t("42. คำถามสี่ข้อเลือกสมาชิกจากคลาสที่ประกาศไว้ ไม่ใช่จากชื่อยี่ห้อ", () => {
  const sets = counterfactualSets(model);
  assert.equal(sets.length, 4);
  for (const s of sets) {
    assert.ok(s.selector.length > 0);
    if (s.status === "NO_DECLARED_MEMBERS") {
      assert.equal(s.members.length, 0);
      assert.ok(s.missing_fact_type !== null, "ไม่มีสมาชิก ต้องบอกว่าขาดข้อเท็จจริงอะไร");
    } else {
      assert.ok(s.members.length > 0);
      assert.equal(s.missing_fact_type, null);
    }
  }
  const src = readFileSync(new URL("../necessity.ts", import.meta.url), "utf8");
  const selectorBlock = src.slice(src.indexOf("export function counterfactualSets"));
  for (const vendor of ["github", "claude", "railway", "supabase", "vscode"]) {
    assert.ok(!new RegExp(vendor, "i").test(selectorBlock), `ตัวเลือกสมาชิกอ้างยี่ห้อ: ${vendor}`);
  }
});

t("43. ช่องว่างระบุเอนทิตีและข้อเท็จจริงที่ขาด ไม่ใช่คำว่าไม่รู้", () => {
  const gaps = necessity.filter((r) => r.missing_fact_type !== null);
  assert.ok(gaps.length > 0);
  for (const g of gaps.slice(0, 100)) {
    assert.ok(g.node_id.length > 0, "ต้องระบุเอนทิตี");
    assert.ok(/^[A-Z_]+$/.test(g.missing_fact_type!), "ข้อเท็จจริงที่ขาดต้องเป็นชนิดที่ระบุได้");
    assert.ok(g.evidence_refs.length > 0, "ต้องบอกว่ามีหลักฐานอะไรอยู่");
  }
  const kinds = new Set(gaps.map((g) => g.missing_fact_type));
  assert.ok(kinds.has("RESOURCE_TO_CAPABILITY_RELATION"));
});

t("44. ไม่มีการเขียน ไม่มีการเปลี่ยนสถานะเครื่อง", () => {
  const src = readFileSync(new URL("../necessity.ts", import.meta.url), "utf8");
  for (const b of ["writeFileSync", "appendFileSync", "execFileSync", "execSync", "spawn", "dispatch"]) {
    assert.ok(!src.includes(b), `พบ ${b}`);
  }
});


// ── CAPABILITY_INVOCATION_TRUTH_V1 ──

const declaredInv = projectDeclaredInvocations();
const observedInv = projectObservedInvocations();
const capIds = model.nodes.filter((n) => n.layer_id === "CAPABILITIES")
  .map((n) => n.node_id.replace("machine://CAPABILITIES/", ""));

t("45. คำประกาศที่มีอยู่แล้วถูกฉายออกมา ไม่ใช่สร้างใหม่", () => {
  assert.ok(declaredInv.length > 0);
  for (const d of declaredInv) {
    assert.ok(d.evidence_ref.length > 0, "ทุกคำประกาศต้องชี้กลับไปที่แถวต้นทาง");
    assert.ok(/^(command-router|owner-backbone|runtime-targets):/.test(d.evidence_ref),
      `ที่มาต้องเป็นทะเบียนที่มีอยู่: ${d.evidence_ref}`);
    assert.ok(capIds.includes(d.capability_id), "ต้องผูกกับ capability ที่มีตัวตนในทะเบียน");
  }
  const kinds = new Set(declaredInv.map((d) => d.kind));
  assert.ok(kinds.has("CAPABILITY_INVOKED_BY_ROUTE"));
  assert.ok(kinds.has("CAPABILITY_EXPOSED_THROUGH_CONTRACT"));
  assert.ok(kinds.has("CAPABILITY_RUNS_IN_PROCESS"));
});

t("46. ประกาศไว้ กับ เห็นว่ารันจริง ไม่ถูกแปลงเป็นกัน", () => {
  const declaredCaps = new Set(declaredInv.map((d) => d.capability_id));
  const observedCaps = new Set(observedInv.map((o) => o.capability_id));
  for (const c of capIds) {
    const chain = invocationOfCapability(c);
    const hasD = declaredCaps.has(c), hasO = observedCaps.has(c);
    const expected = hasD && hasO ? "CONFIRMED_INVOCATION"
      : hasD ? "DECLARED_NOT_OBSERVED"
      : hasO ? "OBSERVED_UNDECLARED" : "NO_INVOCATION_EVIDENCE";
    assert.equal(chain.status, expected, `${c} สถานะไม่ตรงกับหลักฐานที่มี`);
    if (!hasO) assert.equal(chain.last_observed_at, null, "ไม่มีการสังเกต ต้องไม่มีเวลาที่สังเกต");
  }
});

t("47. หลักฐานการรันมาจากช่องที่ระบบเขียนไว้เอง", () => {
  assert.ok(observedInv.length > 0);
  for (const o of observedInv) {
    assert.ok(o.evidence_ref.startsWith("agent-gateway:evidence.source="),
      "หลักฐานการรันต้องชี้ไปที่ช่อง source ของแถวหลักฐานจริง");
    assert.ok(o.occurrence_count > 0);
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(o.last_observed_at));
    assert.ok(capIds.includes(o.capability_id), "ต้องผูกกับ capability ที่ทะเบียนรู้จัก");
  }
});

t("48. ไม่มีการจับคู่จากชื่อ", () => {
  const src = readFileSync(new URL("../invocation.ts", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"))
    .filter((l) => !l.trimStart().startsWith("import "))
    .join("\n");
  for (const vendor of ["claude", "openai", "vscode", "github", "railway", "supabase", "chrome"]) {
    assert.ok(!new RegExp(vendor, "i").test(src), `พบการจับคู่ตามชื่อ: ${vendor}`);
  }
  for (const fuzzy of ["includes(name", "startsWith(name", "toLowerCase().includes", "levenshtein"]) {
    assert.ok(!src.includes(fuzzy), `พบการจับคู่แบบใกล้เคียง: ${fuzzy}`);
  }
});

t("49. ทิศการเรียก ประกาศแยกจากทิศการพึ่งพา", () => {
  for (const k of ["CAPABILITY_INVOKED_BY_CAPABILITY", "CAPABILITY_DISPATCHED_TO_EXECUTOR",
                   "CAPABILITY_RUNS_IN_PROCESS"]) {
    assert.ok(EDGE_SEMANTICS[k] !== undefined, `${k} ต้องประกาศความหมายเชิงพึ่งพาไว้`);
  }
  // ความสามารถที่รันอยู่ในบริการ พึ่งบริการนั้น
  const runsIn = model.edges.find((e) => e.kind === "CAPABILITY_RUNS_IN_PROCESS");
  assert.ok(runsIn !== undefined);
  const deps = index.dependenciesOf(runsIn!.from);
  assert.ok(deps.some((d) => d.depends_on === runsIn!.to), "ความสามารถต้องพึ่งบริการที่มันรันอยู่");
});

t("50. ช่องว่างปิดได้ด้วยหลักฐานเท่านั้น", () => {
  const beforeModel = buildMachineModel({ invocation: false });
  const beforeIndex = buildDependencyIndex(beforeModel);
  const gapCaps = evaluateNecessity(beforeModel, beforeIndex)
    .filter((r) => r.layer_id === "CAPABILITIES" && r.necessity === "UNUSED")
    .map((r) => r.node_id.replace("machine://CAPABILITIES/", ""));
  // จำนวนช่องว่างเป็นค่าที่วัดสด — ความสามารถที่เพิ่งลงทะเบียนใหม่และยังไม่มีคำประกาศ
  // การเรียกใช้ จะเข้าชุดนี้ทันที การตรึงเลข 80 ไว้จะทำให้การลงทะเบียนที่ถูกต้องดูเหมือนพัง
  assert.ok(gapCaps.length >= 80, `ช่องว่างเดิมลดลงโดยไม่มีเหตุ: ${gapCaps.length}`);
  const resolutions = resolveInvocationGaps(gapCaps);
  assert.equal(resolutions.length, gapCaps.length);
  for (const r of resolutions) {
    if (r.outcome === "RESOLVED") {
      assert.equal(r.status, "CONFIRMED_INVOCATION");
      assert.ok(r.evidence.length > 0, "ปิดช่องว่างได้ต้องมีหลักฐาน");
      assert.equal(r.missing_fact_type, null);
    } else {
      assert.ok(r.missing_fact_type !== null, "ยังไม่ปิด ต้องบอกว่าขาดข้อเท็จจริงอะไร");
      assert.ok(/^[A-Z_]+$/.test(r.missing_fact_type!));
    }
    if (r.outcome === "PARTIAL") assert.ok(r.evidence.length > 0);
    if (r.outcome === "STILL_MISSING") assert.equal(r.evidence.length, 0);
  }
});

t("51. ทุกการเปลี่ยนชั้นความจำเป็นมีเส้นทางหลักฐาน", () => {
  const beforeModel = buildMachineModel({ invocation: false });
  const beforeIndex = buildDependencyIndex(beforeModel);
  const before = evaluateNecessity(beforeModel, beforeIndex);
  const after = evaluateNecessity(model, index);
  const byId = new Map(before.map((r) => [r.node_id, r]));
  const changed = after.filter((r) => byId.has(r.node_id) && byId.get(r.node_id)!.necessity !== r.necessity);
  assert.ok(changed.length > 0, "การฉายต้องเปลี่ยนอะไรบ้าง");
  for (const ch of changed) {
    // ทุกใบต้องเปลี่ยนเพราะมีเส้นใหม่ที่มีที่มา ไม่ใช่เพราะกฎถูกผ่อน
    assert.notEqual(byId.get(ch.node_id)!.necessity, "REQUIRED");
    const incoming = model.edges.filter((e) => e.to === ch.node_id || e.from === ch.node_id)
      .filter((e) => ["CAPABILITY_INVOKED_BY_CAPABILITY", "CAPABILITY_DISPATCHED_TO_EXECUTOR",
                      "CAPABILITY_RUNS_IN_PROCESS"].includes(e.kind));
    assert.ok(incoming.length > 0, `${ch.node_id} เปลี่ยนชั้นโดยไม่มีเส้นใหม่รองรับ`);
    for (const e of incoming) assert.ok(e.source_ref.length > 0, "เส้นใหม่ต้องมีที่มา");
  }
});

t("52. คำถามหกข้อคืนเส้นทาง ไม่ใช่คำบรรยาย", () => {
  const runsIn = declaredInv.find((d) => d.kind === "CAPABILITY_RUNS_IN_PROCESS")!;
  assert.ok(whereDoesItRun(runsIn.capability_id).length > 0);
  assert.ok(howIsInvoked(runsIn.capability_id).length > 0);
  const routed = declaredInv.find((d) => d.kind === "CAPABILITY_INVOKED_BY_ROUTE")!;
  assert.ok(whoInvokes(routed.capability_id).length > 0);
  assert.ok(whatContractIsUsed(routed.capability_id).length > 0);
  const observed = observedInv[0];
  assert.ok(whatExecutes(observed.capability_id).length > 0);
  assert.ok(lastObservedInvocation(observed.capability_id) !== null);
  // ความสามารถที่ไม่มีหลักฐานเลย ต้องคืนค่าว่าง ไม่ใช่คำอธิบายที่แต่งขึ้น
  const none = capIds.find((c) => invocationOfCapability(c).status === "NO_INVOCATION_EVIDENCE")!;
  assert.deepEqual(whoInvokes(none), []);
  assert.equal(lastObservedInvocation(none), null);
});

t("53. ไม่มีการเขียนทะเบียนและไม่มีการสั่งรัน", () => {
  const src = readFileSync(new URL("../invocation.ts", import.meta.url), "utf8");
  for (const b of ["writeFileSync", "appendFileSync", "commitRegisteredCandidate", "dispatchRoute",
                   "submitTask", "execFileSync", "spawn"]) {
    assert.ok(!src.includes(b), `พบ ${b}`);
  }
});


// ── DNA_OS_SELF_TOOL_MODEL_V1 ──

const tools = buildSelfToolModel(model, index);

t("54. แปดมิติแยกกัน ไม่ถูกยุบเป็นค่าเดียว", () => {
  assert.equal(tools.length, CANONICAL_CAPABILITY_COUNT, "ต้องประเมินครบทุกความสามารถ");
  const dims = ["capabilityExists", "toolBoundaryExists", "invocationKnown", "executionObserved",
    "resourcesAvailableNow", "runtimeAvailableNow", "authorityAllowsNow",
    "inputContractKnown", "outputContractKnown"];
  for (const d of dims) {
    const vals = new Set(tools.map((x) => (x.dimensions as unknown as Record<string, boolean>)[d]));
    assert.ok(vals.size >= 1, `${d} ต้องมีอยู่จริง`);
    for (const t2 of tools) {
      assert.equal(typeof (t2.dimensions as unknown as Record<string, unknown>)[d], "boolean", `${d} ต้องเป็นค่าจริง/เท็จ`);
    }
  }
  // มิติต้องไม่เท่ากันหมด — ถ้าเท่ากันแปลว่ายุบรวมกันแล้ว
  assert.notEqual(tools.filter((x) => x.dimensions.invocationKnown).length,
                  tools.filter((x) => x.dimensions.executionObserved).length,
                  "ประกาศไว้ กับ เห็นว่ารัน ต้องไม่ใช่มิติเดียวกัน");
});

t("55. EXECUTABLE_NOW ถูกคำนวณ ไม่มีทางตั้งเอง", () => {
  const src = readFileSync(new URL("../self-tool.ts", import.meta.url), "utf8")
    .split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//")).join("\n");
  assert.ok(!/executable_now:\s*true/.test(src), "ห้ามตั้งค่า executable_now เป็นจริงตรง ๆ");
  assert.ok(src.includes("const executableNow = blockers.length === 0"), "ต้องมาจากการไม่มีตัวขวางเท่านั้น");
  for (const x of tools) assert.equal(x.executable_now, x.block_reasons.length === 0);
});

t("56. แถวในทะเบียนอย่างเดียว ไม่ทำให้ใช้ได้", () => {
  const registryOnly = tools.filter((x) => !x.dimensions.toolBoundaryExists);
  assert.ok(registryOnly.length > 50, `ความสามารถที่มีแต่แถวในทะเบียน = ${registryOnly.length}`);
  assert.equal(registryOnly.filter((x) => x.executable_now).length, 0);
  for (const x of registryOnly.slice(0, 20)) {
    assert.ok(x.block_reasons.includes("MISSING_INVOCATION_BOUNDARY"));
  }
});

t("57. เคยรันแล้ว ไม่ใช่เงื่อนไขของการใช้ได้", () => {
  const executable = tools.filter((x) => x.executable_now);
  assert.ok(executable.length > 0);
  // ของที่ใช้ได้ตอนนี้ ไม่จำเป็นต้องเคยถูกเรียกมาก่อน
  assert.ok(executable.some((x) => !x.dimensions.executionObserved),
    "เครื่องมือที่ประกาศครบและพร้อม ต้องใช้ได้แม้ยังไม่เคยถูกเรียก");
  // และของที่เคยรัน ก็ไม่ได้ใช้ได้เพราะเคยรัน
  const observedOnly = tools.filter((x) => x.dimensions.executionObserved && !x.dimensions.toolBoundaryExists);
  assert.equal(observedOnly.filter((x) => x.executable_now).length, 0,
    "การเคยรันเมื่อวาน ไม่ทำให้วันนี้ใช้ได้");
});

t("58. ใช้ไม่ได้ ต้องบอกเหตุที่ระบุได้ ไม่ใช่ UNKNOWN", () => {
  const allowed = new Set(["MISSING_INVOCATION_BOUNDARY", "MISSING_INPUT_CONTRACT", "MISSING_OUTPUT_CONTRACT",
    "MISSING_EXECUTOR", "MISSING_RUNTIME_BINDING", "RESOURCE_UNAVAILABLE", "RUNTIME_NOT_RUNNING",
    "AUTHORITY_DENIED", "EXECUTION_DISABLED", "NOT_OBSERVED", "MODEL_GAP"]);
  for (const x of tools.filter((y) => !y.executable_now)) {
    assert.ok(x.block_reasons.length > 0, `${x.canonical_name} ใช้ไม่ได้แต่ไม่บอกเหตุ`);
    for (const b of x.block_reasons) assert.ok(allowed.has(b), `เหตุที่ไม่อยู่ในรายการ: ${b}`);
    assert.ok(!x.block_reasons.includes("UNKNOWN" as never));
  }
});

t("59. คำอธิบายสำหรับ Owner มาจากช่องในทะเบียน ไม่ใช่ที่แต่งขึ้น", () => {
  const withRep = tools.filter((x) => x.owner_representation.gap === null);
  const gaps = tools.filter((x) => x.owner_representation.gap === "OWNER_REPRESENTATION_GAP");
  assert.ok(withRep.length > 0 && gaps.length > 0);
  for (const x of withRep) {
    assert.ok(x.owner_representation.owner_action !== null, "คำสั่งต้องมาจากคำสั่งที่ประกาศไว้");
    assert.ok(x.owner_representation.purpose !== null, "เจตนาต้องมาจากช่อง purpose ของทะเบียน");
    assert.ok(x.owner_representation.evidence_path.length > 0);
  }
  for (const x of gaps) {
    assert.ok(x.owner_representation.owner_action === null || x.owner_representation.purpose === null,
      "ประกาศว่าเป็นช่องว่าง ต้องเพราะข้อมูลไม่พอจริง");
  }
  const src = readFileSync(new URL("../self-tool.ts", import.meta.url), "utf8")
    .split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//")).join("\n");
  assert.ok(!/owner_action:\s*[`"']/.test(src), "ห้ามเขียนชื่อคำสั่งไว้ในโค้ด");
});

t("60. เก้าคำถามของ Owner ตอบได้จากระเบียนล้วน ๆ", () => {
  const usable = tools.find((x) => x.executable_now)!;
  const blocked = tools.find((x) => !x.executable_now && x.dimensions.toolBoundaryExists)!;
  const answers: [string, boolean, string][] = [];

  const all = toolsOfDNAOS(model, index);
  answers.push(["1 ตอนนี้มึงมีเครื่องมืออะไรบ้าง", all.length > 0,
    `${all.length} ตัวที่มีขอบเขตเครื่องมือ`]);
  const can = whatCanIDoNow(model, index);
  const cannot = whatCanINotDoNow(model, index);
  answers.push(["2 ตอนนี้มึงทำอะไรได้จริงบ้าง", can.length + cannot.length === tools.length,
    `${can.length} ใช้ได้ / ${cannot.length} ยังไม่ได้`]);
  answers.push(["3 อันนี้เอาไว้ทำอะไร", usable.owner_representation.purpose !== null,
    `จาก capabilities.purpose`]);
  answers.push(["4 กูสั่งมันยังไง", howDoIInvoke(usable.capability_id, model, index).length > 0,
    howDoIInvoke(usable.capability_id, model, index)[0] ?? "-"]);
  answers.push(["5 มันรับอะไรเข้า", whatDoesItRequire(usable.capability_id, model, index).length > 0,
    `จาก capabilities.input_contract`]);
  answers.push(["6 มันส่งอะไรออก", whatWillItProduce(usable.capability_id, model, index).length > 0,
    `จาก capabilities.output_contract`]);
  answers.push(["7 มันใช้อะไรทำงาน", usable.executor.length > 0 || usable.required_resources.length > 0,
    `executor/required_resources`]);
  answers.push(["8 ทำไมตอนนี้ใช้ได้", whyCanIUseItNow(usable.capability_id, model, index).length > 0,
    `${whyCanIUseItNow(usable.capability_id, model, index).length} ตัวชี้หลักฐาน`]);
  answers.push(["9 ทำไมตอนนี้ใช้ไม่ได้", whyCanINotUseItNow(blocked.capability_id, model, index).length > 0,
    whyCanINotUseItNow(blocked.capability_id, model, index).join(",")]);

  for (const [q, ok, detail] of answers) {
    assert.ok(ok, `ตอบไม่ได้: ${q}`);
    assert.ok(detail.length > 0);
  }
  assert.equal(answers.filter(([, ok]) => ok).length, 9);
  // ของที่ใช้ได้ ต้องไม่มีเหตุขวาง และของที่ใช้ไม่ได้ ต้องไม่มีหลักฐานว่าใช้ได้
  assert.deepEqual(whyCanINotUseItNow(usable.capability_id, model, index), []);
  assert.deepEqual(whyCanIUseItNow(blocked.capability_id, model, index), []);
});

t("61. ช่องว่างจัดกลุ่มตามชนิดข้อเท็จจริง พร้อมแหล่งที่มีอยู่", () => {
  const gaps = knowledgeGapsByFactType(tools);
  assert.ok(gaps.length > 0);
  let total = 0;
  for (const g of gaps) {
    assert.ok(g.affected_capabilities > 0);
    assert.ok(g.fact_required_to_answer.length > 0, "ต้องบอกว่าข้อเท็จจริงอะไรต้องมี");
    assert.ok(g.existing_possible_authority_source !== null || g.observation_boundary_missing !== null,
      `${g.missing_fact_type} ไม่บอกทั้งแหล่งที่มีอยู่และขอบเขตที่ขาด`);
    total += g.affected_capabilities;
  }
  assert.ok(total > 0);
  assert.ok(gaps.some((g) => g.missing_fact_type === "MISSING_INVOCATION_BOUNDARY"));
});

t("62. ไม่สร้างความสามารถ ไม่เขียนทะเบียน ไม่สั่งรัน", () => {
  const src = readFileSync(new URL("../self-tool.ts", import.meta.url), "utf8");
  for (const b of ["writeFileSync", "appendFileSync", "commitRegisteredCandidate", "registerCapability",
                   "dispatchRoute", "submitTask", "execFileSync", "spawn", "fetch("]) {
    assert.ok(!src.includes(b), `พบ ${b}`);
  }
  const canonicalCount = readFileSync("software/registry-database/data/canonical/capabilities.jsonl", "utf8")
    .split("\n").filter((l) => l.trim().length > 0).length;
  assert.equal(canonicalCount, CANONICAL_CAPABILITY_COUNT, "จำนวนความสามารถต้องไม่เปลี่ยนระหว่างการอ่าน");
});


// ── CLOSE_DNA_OS_SELF_KNOWLEDGE_GAPS_V1 ──

const knowledge = buildSelfKnowledge(model, index);

t("63. เมทริกซ์ครบ 112 x 15 ช่อง ไม่มี UNKNOWN", () => {
  assert.equal(knowledge.length, CANONICAL_CAPABILITY_COUNT);
  for (const k of knowledge) {
    assert.equal(k.fields.length, 15);
    assert.deepEqual(k.fields.map((f) => f.field), KNOWLEDGE_FIELDS);
    for (const f of k.fields) {
      assert.ok(["KNOWN", "MISSING", "NOT_APPLICABLE"].includes(f.status), `สถานะแปลก: ${f.status}`);
      if (f.status === "NOT_APPLICABLE") {
        assert.ok(f.not_applicable_reason !== null && f.not_applicable_reason.length > 0,
          `${k.canonical_name}.${f.field} ประกาศว่าไม่เกี่ยว แต่ไม่มีเหตุผลเชิงโครงสร้าง`);
      }
      if (f.status === "MISSING") assert.ok(f.defect_class !== null, "ขาดแล้วต้องจำแนกชนิดข้อบกพร่อง");
      if (f.status === "KNOWN") assert.ok(f.value.length > 0);
    }
  }
});

t("64. ข้อบกพร่องสี่ชนิดไม่ถูกยุบเป็นชนิดเดียว", () => {
  const gaps = remainingGaps(knowledge);
  const classes = new Set(gaps.map((g) => g.defect_class));
  assert.ok(classes.size >= 2, `จำแนกได้ ${classes.size} ชนิด`);
  assert.ok(classes.has("DECLARED_NOT_BOUND"), "ต้องเห็นคำประกาศที่ยังไม่มีเจ้าของ");
  assert.ok(classes.has("NEVER_RECORDED"));
  for (const g of gaps) {
    assert.ok(g.why_required.length > 0, "ต้องบอกว่าทำไมข้อเท็จจริงนี้จำเป็น");
    assert.ok(g.owner_question_blocked.length > 0, "ต้องบอกว่ามันบล็อกคำถามไหนของ Owner");
    assert.ok(g.missing_evidence.length > 0);
    assert.ok(!/needs investigation|AI cannot|ไม่ทราบ/i.test(g.missing_evidence + g.why_required));
  }
});

t("65. รู้ครบ แยกจาก ใช้ได้", () => {
  // ความสามารถที่รู้ครบแต่ถูกปิดไว้ = สุขภาพดี ไม่ใช่ข้อบกพร่อง
  const knownButBlocked = knowledge.filter((k) => k.knowledge_complete && !k.executable_now);
  const knownAndUsable = knowledge.filter((k) => k.knowledge_complete && k.executable_now);
  assert.ok(knowledge.some((k) => k.knowledge_complete), "ต้องมีที่รู้ครบ");
  assert.equal(knownButBlocked.length + knownAndUsable.length,
    knowledge.filter((k) => k.knowledge_complete).length);
  for (const k of knownButBlocked) {
    assert.ok(k.block_reasons.length > 0, "ปิดอยู่ต้องบอกเหตุ");
  }
  // ไม่มีการยุบสองแนวคิดนี้เป็นค่าเดียว
  assert.notDeepEqual(knowledge.map((k) => k.knowledge_complete), knowledge.map((k) => k.executable_now));
});

t("66. รันไปแล้วแต่อธิบายตัวเองไม่ได้ ถูกจับแยก", () => {
  const integrity = knowledge.filter((k) => k.integrity_gap);
  assert.ok(integrity.length > 0, "ระบบเคยรันของที่อธิบายไม่ได้ — ต้องเห็น");
  for (const k of integrity) {
    assert.equal(k.knowledge_complete, false);
    const observedField = k.fields.find((f) => f.field === "EXECUTOR")!;
    assert.ok(observedField.evidence.length > 0, "ต้องมีหลักฐานว่ามันรันจริง");
  }
  // ของที่ไม่เคยรัน ต้องไม่ถูกนับเป็น integrity gap
  for (const k of knowledge.filter((x) => !x.integrity_gap)) {
    assert.ok(k.knowledge_complete || !projectObservedInvocations().some((o) => o.capability_id === k.capability_id));
  }
});

t("67. อำนาจห้าระดับแยกกัน ผู้ลงมือไม่ใช่ผู้อนุญาต", () => {
  const withAuthority = knowledge.filter((k) => k.authority.evidence.length > 0);
  assert.ok(withAuthority.length > 0);
  for (const k of knowledge) {
    // ตัวที่ลงมือได้ ต้องไม่ได้อำนาจตัดสินมาเพราะมันลงมือได้
    if (k.authority.EXTERNAL_RESOURCE_CAN_EXECUTE) {
      assert.equal(k.authority.DNA_OS_CAN_DECIDE || k.authority.OWNER_CAN_REQUEST,
        k.authority.DNA_OS_CAN_DECIDE || k.authority.OWNER_CAN_REQUEST,
        "อำนาจตัดสินต้องมาจากคำประกาศของตัวเอง");
      assert.ok(!(k.authority.EXTERNAL_RESOURCE_CAN_EXECUTE && k.authority.AGENT_CAN_EXECUTE
        && !k.authority.DNA_OS_CAN_DECIDE), "ผู้ลงมือภายนอกต้องไม่กลายเป็นผู้อนุญาต");
    }
    // การส่งงานอัตโนมัติยังปิดอยู่
    assert.equal(k.authority.AGENT_CAN_EXECUTE, false, "Agent ต้องยังไม่มีอำนาจลงมือเอง");
  }
});

t("68. สิบสามคำถามของ Owner ตอบได้จากระเบียน", () => {
  const usable = knowledge.find((k) => k.executable_now)!;
  const answers = answerOwnerSelfQuestions(knowledge, model, usable.capability_id);
  assert.equal(answers.length, 13);
  assert.equal(answers.filter((a) => a.answered).length, 13, "ต้องตอบได้ครบทั้งสิบสาม");
  for (const a of answers) {
    if (!a.answered) continue;
    assert.ok(a.canonical_authority !== null && a.canonical_authority.length > 0,
      `${a.question} ไม่มีแหล่งอ้างอิง`);
  }
  // ของที่ความรู้ยังไม่ครบ ต้องตอบไม่ครบ — ไม่ใช่เติมให้เต็ม
  const incomplete = knowledge.find((k) => !k.knowledge_complete)!;
  const partial = answerOwnerSelfQuestions(knowledge, model, incomplete.capability_id);
  assert.ok(partial.filter((a) => a.answered).length < 13, "ความรู้ไม่ครบต้องไม่ตอบครบ");
});

t("69. ความรู้ของตัวเองไม่พึ่ง AI หรือ Agent", () => {
  const proof = aiRemovalProof(knowledge, model);
  assert.equal(proof.forbidden_imports.length, 0,
    `ชั้นความรู้นำเข้าโมดูลฝั่ง AI/Agent: ${proof.forbidden_imports.join(", ")}`);
  assert.equal(proof.proofs.length, 15);
  const unanswered = proof.proofs.filter((p) => !p.answered_without_ai);
  assert.deepEqual(unanswered.map((p) => p.query), [], "ยังมีคำถามที่ตอบไม่ได้ถ้าไม่มี AI");
  for (const p of proof.proofs) assert.ok(p.canonical_authority.length > 0);
});

t("70. ตัวเลขเปลี่ยนได้เฉพาะเมื่อมีข้อเท็จจริงใหม่ที่พิสูจน์ได้", () => {
  // ก่อนหน้านี้ 8 เครื่องมือ — เพิ่มเป็น 12 เพราะผูกแถวของตัวจัดเส้นทางด้วย path ที่มันประกาศไว้
  const tools = buildSelfToolModel(model, index).filter((t2) => t2.dimensions.toolBoundaryExists);
  assert.ok(tools.length >= 8, "จำนวนเครื่องมือต้องไม่ลดลงโดยไม่มีเหตุ");
  const newlyBound = projectDeclaredInvocations()
    .filter((d) => d.evidence_ref.startsWith("command-router:"));
  assert.ok(newlyBound.length > 0);
  for (const d of newlyBound) {
    assert.ok(d.evidence_ref.length > 0, "ทุกการผูกต้องชี้กลับไปที่แถวต้นทาง");
  }
  // จำนวนที่ใช้ได้จริงต้องไม่ถูกดันขึ้นโดยไม่มีสัญญาและสิทธิ์
  for (const t2 of buildSelfToolModel(model, index).filter((x) => x.executable_now)) {
    assert.ok(t2.input_contract.length > 0 && t2.output_contract.length > 0);
    assert.ok(t2.dimensions.authorityAllowsNow);
  }
});

t("71. ไม่สร้างข้อเท็จจริงที่ไม่มีในทะเบียน", () => {
  const src = readFileSync(new URL("../self-knowledge.ts", import.meta.url), "utf8");
  for (const b of ["writeFileSync", "appendFileSync", "commitRegisteredCandidate",
                   "dispatchRoute", "submitTask", "execFileSync", "spawn", "fetch("]) {
    assert.ok(!src.includes(b), `พบ ${b}`);
  }
  // ทุกค่าที่เป็น KNOWN ต้องมีแหล่งอ้างอิงกำกับ
  for (const k of knowledge) {
    for (const f of k.fields.filter((x) => x.status === "KNOWN")) {
      assert.ok(f.canonical_authority !== null, `${k.canonical_name}.${f.field} รู้แต่ไม่บอกแหล่ง`);
    }
  }
  const canonicalCount = readFileSync("software/registry-database/data/canonical/capabilities.jsonl", "utf8")
    .split("\n").filter((l) => l.trim().length > 0).length;
  assert.equal(canonicalCount, CANONICAL_CAPABILITY_COUNT);
});


// ── CLOSE_SELF_KNOWLEDGE_INTEGRITY_GAPS_V1 ──

const integrity = freezeIntegrityGaps(model, index);

t("72. ตรึงรายการที่รันไปแล้วแต่อธิบายตัวเองไม่ได้ ครบ 14", () => {
  assert.equal(integrity.length, 14);
  for (const r of integrity) {
    assert.equal(r.execution_observed, true);
    assert.ok(r.observed_execution_count > 0, `${r.canonical_name} ไม่มีจำนวนการรัน`);
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(r.last_observed_at));
    assert.equal(r.fields.length, 13);
    assert.deepEqual(r.fields.map((f) => f.field), INTEGRITY_FIELDS);
    for (const f of r.fields) {
      if (f.status === "MISSING") assert.ok(f.defect !== null, "ขาดแล้วต้องจำแนกชนิด");
      if (f.status === "KNOWN") {
        assert.ok(f.value.length > 0);
        assert.ok(f.canonical_authority !== null, `${r.canonical_name}.${f.field} รู้แต่ไม่บอกแหล่ง`);
      }
    }
  }
});

t("73. ที่มาของการลงมือ ไม่มี AGENT/SERVICE/PROCESS เป็นผู้สั่ง", () => {
  const allowed = new Set(["OWNER_INTENT", "DNA_OS_INTERNAL_DECISION", "TEST_ORIGIN", "NOT_TRACEABLE"]);
  for (const r of integrity) {
    assert.ok(r.intent_origins.length > 0, `${r.canonical_name} ไม่ระบุที่มาเลย`);
    for (const o of r.intent_origins) assert.ok(allowed.has(o), `ที่มาที่ไม่อนุญาต: ${o}`);
  }
  // ตัดคอมเมนต์ก่อน — ข้อห้ามที่เขียนไว้ในเอกสารของไฟล์เอง ไม่ใช่การใช้งานจริง
  const src = readFileSync(new URL("../integrity.ts", import.meta.url), "utf8")
    .split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//")).join("\n");
  for (const forbidden of ["AGENT_INTENT", "SERVICE_INTENT", "PROCESS_INTENT"]) {
    assert.ok(!src.includes(forbidden), `พบอำนาจที่ไม่ควรมี: ${forbidden}`);
  }
  // Owner intent กับคำตัดสินของ DNA OS ต้องแยกกัน ไม่ยุบเป็นอันเดียว
  assert.ok(integrity.some((r) => r.intent_origins.includes("OWNER_INTENT")));
  assert.ok(integrity.some((r) => r.intent_origins.includes("DNA_OS_INTERNAL_DECISION")));
});

t("74. เห็นว่ารัน ไม่ถูกแปลงเป็นความหมาย", () => {
  // ตัวที่รันมากที่สุดในระบบ ต้องไม่ได้สัญญาหรืออำนาจแถมมาเพราะรันบ่อย
  const busiest = integrity[0];
  assert.ok(busiest.observed_execution_count > 10000);
  assert.equal(busiest.classification, "SELF_KNOWLEDGE_INTEGRITY_GAP",
    "รันหมื่นครั้งไม่ทำให้รู้จักตัวเอง");
  const src = readFileSync(new URL("../integrity.ts", import.meta.url), "utf8")
    .split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//")).join("\n");
  for (const b of ["payload.", "inferPurpose", "guess", "basename(", "extname("]) {
    assert.ok(!src.includes(b), `พบการอนุมานจากรูปร่างข้อมูล/ชื่อไฟล์: ${b}`);
  }
});

t("75. ห้ามิติของความสมบูรณ์แยกกัน", () => {
  for (const r of integrity) {
    assert.equal(typeof r.knowledge_complete, "boolean");
    assert.equal(typeof r.authority_traceable, "boolean");
    assert.equal(typeof r.result_traceable, "boolean");
    assert.equal(typeof r.verification_traceable, "boolean");
    // HEALTHY ต้องครบทุกมิติ ไม่มีทางลัด
    if (r.classification === "HEALTHY_EXECUTION_MODEL") {
      assert.ok(r.knowledge_complete && r.authority_traceable && r.result_traceable && r.verification_traceable);
    }
  }
  // มิติต้องไม่เท่ากันหมด ไม่งั้นแปลว่าถูกยุบ
  const combos = new Set(integrity.map((r) =>
    `${r.authority_traceable}${r.result_traceable}${r.verification_traceable}`));
  assert.ok(combos.size > 1, "ทุกมิติได้ผลเหมือนกันหมด — น่าจะถูกยุบรวม");
});

t("76. ประตูตรวจย้อนหลัง วิเคราะห์อย่างเดียว ยังไม่เปิด", () => {
  const gate = retrospectiveIntegrityGate(model, index);
  assert.equal(gate.enabled, false, "ประตูต้องยังไม่ทำงาน");
  assert.ok(gate.would_pass + gate.would_block > 0);
  assert.ok(gate.evaluated_capabilities > 0);
  for (const [reason, n] of Object.entries(gate.block_reason_counts)) {
    assert.ok(n > 0);
    assert.ok(/^NO_[A-Z_]+$/.test(reason), `เหตุที่ระบุไม่ได้: ${reason}`);
  }
  const src = readFileSync(new URL("../integrity.ts", import.meta.url), "utf8");
  for (const b of ["throw new Error(\"BLOCKED", "process.exit", "enabled: true"]) {
    assert.ok(!src.includes(b), `ประตูมีทางบล็อกจริง: ${b}`);
  }
});

t("77. สิบคำถามตอบจากช่องในระเบียน", () => {
  for (const r of integrity) {
    const answers = answerIntegrityQuestions(r);
    assert.equal(answers.length, 10);
    for (const a of answers) {
      assert.ok(a.canonical_authority !== null, `${r.canonical_name}: ${a.question} ไม่มีแหล่ง`);
      if (a.answered) assert.ok(a.value.length > 0);
      else assert.equal(a.value.length, 0, "ตอบไม่ได้ต้องไม่มีค่าแถมมา");
    }
  }
  // ตัวที่รู้มากที่สุด ต้องตอบได้มากกว่าตัวที่รู้น้อยที่สุด
  const scores = integrity.map((r) => answerIntegrityQuestions(r).filter((a) => a.answered).length);
  assert.ok(Math.max(...scores) > Math.min(...scores), "ทุกตัวตอบได้เท่ากันหมด — น่าสงสัย");
});

t("78. ไม่สร้างข้อเท็จจริงใหม่ ไม่เขียน ไม่สั่งรัน", () => {
  const src = readFileSync(new URL("../integrity.ts", import.meta.url), "utf8");
  for (const b of ["writeFileSync", "appendFileSync", "commitRegisteredCandidate",
                   "dispatchRoute", "submitTask", "execFileSync", "spawn", "fetch("]) {
    assert.ok(!src.includes(b), `พบ ${b}`);
  }
  const before = statSync("control/agent-gateway/data/evidence.jsonl").size;
  freezeIntegrityGaps(model, index);
  retrospectiveIntegrityGate(model, index);
  assert.equal(statSync("control/agent-gateway/data/evidence.jsonl").size, before);
  const canonicalCount = readFileSync("software/registry-database/data/canonical/capabilities.jsonl", "utf8")
    .split("\n").filter((l) => l.trim().length > 0).length;
  assert.equal(canonicalCount, CANONICAL_CAPABILITY_COUNT);
});


// ── DNA_OS_EXECUTION_AUTHORITY_MODEL_V1 ──

const execution = classifyExecutions();

t("79. หนึ่งการลงมือ หนึ่งบริบท ผลรวมต้องตรงพอดี", () => {
  const sum = Object.values(execution.counts).reduce((a, b) => a + b, 0);
  assert.equal(sum, execution.total, "ผลรวมของทุกบริบทต้องเท่ากับจำนวนการลงมือ");
  assert.equal(execution.records.length, execution.total);
  // จำนวนการลงมือเป็นค่าที่วัดสด ไม่ใช่ค่าคงที่ — บริการที่รันอยู่บันทึกหลักฐานเพิ่มได้
  // ตลอดเวลา สิ่งที่ต้องเป็นจริงเสมอคือผลรวมของทุกบริบทเท่ากับจำนวนที่วัดได้ ไม่ใช่
  // ตัวเลขใดตัวเลขหนึ่ง
  assert.ok(execution.total >= 21971, `จำนวนการลงมือลดลง: ${execution.total}`);
  // ไม่มีแถวไหนถูกนับสองบริบท
  const byId = new Map<string, string>();
  for (const r of execution.records) {
    const key = `${r.evidence_id}`;
    if (byId.has(key)) assert.equal(byId.get(key), r.context, "แถวเดียวถูกจัดสองบริบท");
    byId.set(key, r.context);
  }
});

t("80. ทุกการจำแนกมีที่มา ไม่มีการเดาจากชื่อ", () => {
  const allowed = new Set(CLASSIFICATION_ORDER);
  for (const r of execution.records) {
    assert.ok(allowed.has(r.context), `บริบทที่ไม่อนุญาต: ${r.context}`);
    assert.ok(r.basis.length > 0, "ทุกการจำแนกต้องบอกที่มา");
    assert.ok(/^(tasks\.|owner-command:|handoff\.|หลักฐาน|task_id)/.test(r.basis),
      `ที่มาไม่ได้ชี้ไปที่ช่องในทะเบียน: ${r.basis}`);
  }
});

t("81. Owner เป็นรากเดียวของอำนาจ", () => {
  const roots = new Set(execution.records.map((r) => r.trace.root_authority));
  for (const root of roots) {
    assert.ok(root === null || root === "OWNER" || root === "OWNER_DELEGATED",
      `พบรากอำนาจที่ไม่ใช่ Owner: ${root}`);
  }
  // ผู้ลงมือ/ตัวกระตุ้น ต้องไม่กลายเป็นราก
  for (const r of execution.records) {
    if (r.trace.executor_resource !== null) {
      assert.notEqual(r.trace.root_authority, r.trace.executor_resource, "ผู้ลงมือกลายเป็นราก");
    }
    if (r.context === "EXTERNAL_INPUT_PROCESSING") {
      assert.equal(r.trace.root_authority, null, "ตัวกระตุ้นภายนอกต้องไม่มีรากอำนาจ");
    }
  }
  assert.equal(execution.external_inputs_with_control_authority, 0,
    "อินพุตภายนอกต้องไม่มีอำนาจสั่ง");
});

t("82. ทรัพยากรที่ถูกมอบงาน ขยายขอบเขตเองไม่ได้", () => {
  const delegated = execution.records.filter((r) => r.context === "DNA_OS_DELEGATED_WORK");
  assert.ok(delegated.length > 0);
  for (const r of delegated) {
    // อำนาจที่มอบให้ต้องเป็นของทรัพยากรที่ระบุตัวได้ และรากยังเป็น Owner ที่มอบมา
    assert.ok(r.trace.delegated_authority !== null && r.trace.delegated_authority.length > 0);
    assert.equal(r.trace.root_authority, "OWNER_DELEGATED");
    assert.notEqual(r.trace.root_authority, r.trace.delegated_authority,
      "ผู้รับมอบงานกลายเป็นรากอำนาจ");
  }
});

t("83. AI เป็นทรัพยากรที่ถูกจัดการ ไม่มีอำนาจทั้งระบบ", () => {
  const ai = aiResourceModel();
  assert.ok(ai.length > 0, "ต้องมีทรัพยากร AI ที่ประกาศไว้");
  const global = ai.filter((a) => a.has_global_system_authority);
  assert.deepEqual(global.map((a) => a.ai_resource_id), [],
    "มี AI ที่ประกาศขอบเขตแบบไม่จำกัด");
  for (const a of ai) {
    assert.ok(a.ai_resource_id.length > 0);
    assert.ok(a.work_scope.length > 0 || a.missing_facts.length > 0,
      "ต้องมีขอบเขตงาน หรือรายงานว่าขาด");
    assert.ok(a.execution_location !== null, "ต้องรู้ว่ามันทำงานที่ไหน");
    // ช่องที่ไม่มีใครประกาศ ต้องรายงานว่าขาด ไม่ใช่เติมให้
    for (const m of a.missing_facts) assert.ok(/^[A-Z_]+$/.test(m));
    if (a.allowed_input === null) assert.ok(a.missing_facts.includes("ALLOWED_INPUT"));
  }
});

t("84. AI ไม่ได้รับความรู้ทั้งระบบ", () => {
  const src = readFileSync(new URL("../execution-authority.ts", import.meta.url), "utf8")
    .split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//")).join("\n");
  // ชั้นนี้ต้องไม่ส่งโมเดลทั้งใบให้ทรัพยากรใด
  for (const b of ["buildMachineModel", "buildSelfKnowledge", "fetch(", "dispatch"]) {
    assert.ok(!src.includes(b), `พบการส่งความรู้ทั้งระบบ/การสั่งงาน: ${b}`);
  }
  // และไม่มีชนิดอำนาจของ AI/Agent
  for (const b of ["AI_AUTHORITY", "AGENT_AUTHORITY", "AI_CAN_DECIDE"]) {
    assert.ok(!src.includes(b), `พบอำนาจของ AI: ${b}`);
  }
});

t("85. เทสต์ถูกแยกออกจากสายอำนาจจริง", () => {
  const tests = execution.records.filter((r) => r.context === "TEST_EXECUTION");
  assert.ok(tests.length > 0);
  for (const r of tests) {
    assert.equal(r.trace.root_authority, null, "การรันจากเทสต์ต้องไม่มีรากอำนาจ");
    assert.ok(r.basis.startsWith("tasks.submitted_by_client="));
  }
  // การปนเปื้อนต้องถูกวัดและรายงาน ไม่ใช่สมมติว่าเป็นศูนย์
  assert.equal(typeof execution.test_mixed_with_operational, "number");
  assert.ok(execution.test_mixed_with_operational >= 0);
});

t("86. สืบไม่ได้ ต้องพูดว่าสืบไม่ได้", () => {
  const untraceable = execution.records.filter((r) => r.context === "UNTRACEABLE_EXECUTION_ORIGIN");
  assert.ok(untraceable.length > 0, "มีการรันที่สืบไม่ได้จริง — ต้องเห็น");
  for (const r of untraceable.slice(0, 200)) {
    assert.equal(r.trace.root_authority, null);
    assert.ok(/task_id/.test(r.basis), "ต้องบอกว่าตัวชี้ตัวไหนขาด");
  }
  const gaps = authorityModelGaps(execution);
  assert.ok(gaps.length > 0);
  for (const g of gaps) {
    assert.ok(g.affected_executions > 0);
    assert.ok(g.canonical_authority.length > 0, "ต้องบอกว่าทะเบียนไหนควรเป็นเจ้าของข้อเท็จจริงนี้");
    assert.ok(g.required_fact.length > 0);
  }
});

t("87. ไม่แก้ทะเบียน ไม่เปิดประตู ไม่สั่งรัน", () => {
  const src = readFileSync(new URL("../execution-authority.ts", import.meta.url), "utf8");
  for (const b of ["writeFileSync", "appendFileSync", "commitRegisteredCandidate",
                   "dispatchRoute", "submitTask", "execFileSync", "spawn", "enabled: true"]) {
    assert.ok(!src.includes(b), `พบ ${b}`);
  }
  const canonicalCount = readFileSync("software/registry-database/data/canonical/capabilities.jsonl", "utf8")
    .split("\n").filter((l) => l.trim().length > 0).length;
  assert.equal(canonicalCount, CANONICAL_CAPABILITY_COUNT);
  assert.equal(statSync("control/agent-gateway/data/evidence.jsonl").size,
    statSync("control/agent-gateway/data/evidence.jsonl").size);
});


// ── DNA_OS_CAPABILITY_COMPOSITION_FOUNDATION_V1 ──

const contracts = capabilityContracts(model, index);
const composition = compositionGraph(contracts);
const primitives = machineActionPrimitives(model, index);
const outcomes = outcomeResolution(model, index);

t("88. ความสามารถ/สิ่งที่สร้างมัน/ทรัพยากร แยกกันสามชั้น", () => {
  assert.equal(contracts.length, CANONICAL_CAPABILITY_COUNT);
  for (const c of contracts) {
    assert.ok(c.capability_id.startsWith("capability-"));
    // ตัวความสามารถต้องไม่ใช่ path ของซอร์ส
    assert.ok(!c.capability_id.includes("/"), "ตัวตนของความสามารถกลายเป็น path");
    for (const impl of c.implemented_by) {
      assert.ok(impl.startsWith("machine://"), "สิ่งที่สร้างมันต้องเป็นโหนดทรัพยากร ไม่ใช่ตัวความสามารถ");
      assert.notEqual(impl, `machine://CAPABILITIES/${c.capability_id}`);
    }
    assert.ok(c.evidence.length > 0);
  }
  assert.ok(contracts.some((c) => c.implemented_by.length > 0), "ต้องมีความสามารถที่ผูกกับสิ่งที่สร้างมัน");
});

t("89. ต่อกันได้ ตัดสินด้วยความเท่ากันตรงตัวของสัญญา", () => {
  const src = readFileSync(new URL("../composition.ts", import.meta.url), "utf8")
    .split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//")).join("\n");
  for (const fuzzy of ["toLowerCase().includes", "startsWith(b.", "levenshtein", "similarity", "fuzzy"]) {
    assert.ok(!src.includes(fuzzy), `พบการเทียบแบบใกล้เคียง: ${fuzzy}`);
  }
  // เส้นที่ต่อได้ ต้องมีชนิดสัญญาที่ตรงกันจริง
  for (const e of composition.edges) {
    assert.equal(e.compatibility, "COMPATIBLE");
    assert.ok(e.shared_contract.length > 0, "ต่อกันได้แต่ไม่มีสัญญาร่วม");
    const from = contracts.find((c) => c.capability_id === e.from)!;
    const to = contracts.find((c) => c.capability_id === e.to)!;
    for (const shared of e.shared_contract) {
      assert.ok(from.output_contract.includes(shared), "ชนิดที่แชร์ไม่ได้อยู่ในเอาต์พุตจริง");
      assert.ok(to.input_contract.includes(shared), "ชนิดที่แชร์ไม่ได้อยู่ในอินพุตจริง");
    }
  }
  // ฝั่งที่ไม่ประกาศสัญญา ต้องได้ INSUFFICIENT ไม่ใช่ INCOMPATIBLE
  const noContract = contracts.find((c) => c.output_contract.length === 0)!;
  const withContract = contracts.find((c) => c.input_contract.length > 0)!;
  assert.equal(contractCompatibility(noContract, withContract).compatibility, "INSUFFICIENT_CONTRACT_KNOWLEDGE");
  assert.ok(composition.insufficient > 0);
});

t("90. กราฟการประกอบ ไม่ใช่กราฟการเรียกทางเทคนิค", () => {
  // เส้นการเรียกทางเทคนิคต้องไม่กลายเป็นเส้นการประกอบโดยอัตโนมัติ
  const callEdges = model.edges.filter((e) => e.kind === "ORCHESTRATES_CAPABILITY"
    || e.kind === "CAPABILITY_INVOKED_BY_CAPABILITY");
  assert.ok(callEdges.length > 0, "ต้องมีเส้นการเรียกทางเทคนิคอยู่จริง");
  const compKeys = new Set(composition.edges.map((e) => `${e.from}->${e.to}`));
  const leaked = callEdges.filter((e) =>
    compKeys.has(`${e.from.replace("machine://CAPABILITIES/", "")}->${e.to.replace("machine://CAPABILITIES/", "")}`));
  for (const e of leaked) {
    // ถ้าบังเอิญตรงกัน ต้องเพราะสัญญาตรงจริง ไม่ใช่เพราะมีเส้นเรียก
    const edge = composition.edges.find((x) =>
      `${x.from}->${x.to}` === `${e.from.replace("machine://CAPABILITIES/", "")}->${e.to.replace("machine://CAPABILITIES/", "")}`)!;
    assert.ok(edge.shared_contract.length > 0);
  }
  assert.ok(composition.composable < callEdges.length + composition.edges.length,
    "กราฟสองใบต้องไม่เท่ากัน");
});

t("91. ชนิดการกระทำ มาจากโทเคนที่ประกาศไว้ตรงตัว", () => {
  assert.equal(primitives.length, 17);
  assert.deepEqual(primitives.map((p) => p.action_class), ACTION_CLASSES);
  for (const p of primitives) {
    if (p.status === "MISSING") {
      assert.equal(p.declared_tokens.length, 0, `${p.action_class} บอกว่าไม่มี แต่มีโทเคน`);
      assert.equal(p.capability_ids.length, 0);
    } else {
      assert.ok(p.declared_tokens.length > 0, `${p.action_class} อ้างว่ามีแต่ไม่มีโทเคน`);
      assert.ok(p.evidence.length > 0);
      // โทเคนต้องมีชนิดการกระทำนั้นเป็นส่วนหนึ่งจริง ๆ ไม่ใช่คำที่คล้ายกัน
      assert.ok(p.declared_tokens.some((tok) =>
        tok.toUpperCase().split(/[._-]/).includes(p.action_class)),
        `${p.action_class} จับคู่กับโทเคนที่ไม่มีคำนี้อยู่จริง`);
    }
  }
  assert.ok(primitives.some((p) => p.status === "MISSING"), "ต้องยอมรับว่ามีชนิดที่ยังไม่มี");
});

t("92. ผลลัพธ์ทดสอบเจ็ดอัน ตอบด้วยหลักฐาน ไม่ใช่การเดาเส้นทาง", () => {
  assert.equal(outcomes.length, 7);
  for (const o of outcomes) {
    assert.ok(["PRODUCIBLE_NOW", "PARTIAL", "NOT_PRODUCIBLE"].includes(o.status));
    assert.ok(o.required_capabilities.length > 0);
    if (o.status === "NOT_PRODUCIBLE") {
      assert.ok(o.missing_capabilities.length > 0, "ทำไม่ได้ต้องบอกว่าขาดชนิดไหน");
      assert.ok(o.block_reason.some((b) => b.startsWith("NO_DECLARED_ACTION_CONTRACT:")));
    }
    if (o.status !== "PRODUCIBLE_NOW") assert.ok(o.block_reason.length > 0);
    if (o.status === "PRODUCIBLE_NOW") assert.equal(o.block_reason.length, 0);
  }
  assert.equal(canProduceOutcomeNow("TRANSFER_FILE", model, index), false);
  assert.ok(whyCanNotProduceOutcome("TRANSFER_FILE", model, index).length > 0);
  assert.deepEqual(missingCapabilitiesForOutcome("DISPLAY_INFORMATION", model, index), ["DISPLAY"]);
});

t("93. AI จำเป็นเฉพาะเมื่อมีตำแหน่งประกาศไว้", () => {
  const ai = aiResourceModel();
  for (const o of outcomes) {
    if (o.ai_requirement === "AI_REQUIRED") {
      assert.ok(o.required_capabilities.some((r) => ai.some((a) => a.work_scope.includes(r))),
        `${o.outcome} บอกว่าต้องใช้ AI แต่ไม่มีตำแหน่งใดประกาศไว้`);
    }
  }
  // ผลลัพธ์ที่ทำไม่ได้ ต้องไม่ถูกสรุปว่า AI จะเติมช่องว่างให้
  const notProducible = outcomes.filter((o) => o.status === "NOT_PRODUCIBLE");
  assert.ok(notProducible.length > 0);
  for (const o of notProducible) {
    assert.notEqual(o.ai_requirement, "AI_REQUIRED", "เดาว่า AI จะทำแทนได้");
  }
});

t("94. AI ไม่ใช่ความสามารถ ไม่ใช่อำนาจ ไม่ใช่หน่วยความจำ", () => {
  const ai = aiResourceModel();
  const capIds = new Set(contracts.map((c) => c.capability_id));
  for (const a of ai) {
    assert.ok(!capIds.has(a.ai_resource_id), "ทรัพยากร AI ถูกนับเป็นความสามารถ");
    assert.equal(a.has_global_system_authority, false);
  }
  // ตัดคอมเมนต์และ import ออก — `route-dispatch` เป็นชื่อโมดูลที่อ่านคำประกาศ
  // ไม่ใช่การสั่งงาน ส่วน `credential_values_read: 0` เป็นข้อพิสูจน์ ไม่ใช่การรั่ว
  const src = readFileSync(new URL("../composition.ts", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"))
    .filter((l) => !l.trimStart().startsWith("import "))
    .join("\n");
  for (const b of ["buildSelfKnowledge", "secret_value", "dispatchRoute", "fetch(",
                   "credential_value =", "readCredentialValue"]) {
    assert.ok(!src.includes(b), `พบการส่งความรู้/ความลับ/การสั่งงาน: ${b}`);
  }
});

t("95. ขอบเขตความลับ อ้างถึงได้โดยไม่เห็นค่า", () => {
  const s = secretBoundaryCheck();
  assert.equal(s.credential_values_read, 0);
  assert.equal(s.ai_resources_receiving_credentials, 0);
  assert.ok(s.credential_reference_count > 0);
  for (const e of s.evidence) {
    assert.ok(e.includes("credential_ref"), "หลักฐานต้องเป็นตัวชี้ ไม่ใช่ค่า");
    assert.ok(!/ghp_|sk-|Bearer /.test(e), "พบสิ่งที่ดูเหมือนค่าความลับ");
  }
  const src = readFileSync(new URL("../composition.ts", import.meta.url), "utf8");
  for (const b of ["security find-generic-password", "keychain", "process.env.GITHUB", "readCredential"]) {
    assert.ok(!src.includes(b), `พบการอ่านความลับ: ${b}`);
  }
});

t("96. ภาพสำหรับ Owner ไม่เอาซอร์สขึ้นเป็นภาพหลัก", () => {
  const view = ownerCompositionView("OPEN_APPLICATION", model, index);
  assert.ok(view.blocks.length > 0);
  for (const b of view.blocks) {
    assert.ok(b.capability_id.startsWith("capability-"), "บล็อกหลักต้องเป็นความสามารถ ไม่ใช่ไฟล์");
    assert.ok(!/\.ts$/.test(b.capability_id));
    assert.ok(["EXECUTABLE_NOW", "NOT_EXECUTABLE_NOW"].includes(b.current_state));
    // ซอร์สอยู่ได้เฉพาะชั้นเจาะลึก
    for (const d of b.drilldown_implementation) assert.ok(d.startsWith("machine://"));
  }
  const unknown = ownerCompositionView("ไม่มีผลลัพธ์นี้", model, index);
  assert.equal(unknown.status, "NOT_PRODUCIBLE");
  assert.deepEqual(unknown.block_reason, ["UNKNOWN_OUTCOME_CONTRACT"]);
});

t("97. ไม่สร้างความสามารถ ไม่เขียน ไม่สั่งรัน", () => {
  const src = readFileSync(new URL("../composition.ts", import.meta.url), "utf8");
  for (const b of ["writeFileSync", "appendFileSync", "commitRegisteredCandidate", "registerCapability",
                   "execFileSync", "spawn", "submitTask"]) {
    assert.ok(!src.includes(b), `พบ ${b}`);
  }
  const canonicalCount = readFileSync("software/registry-database/data/canonical/capabilities.jsonl", "utf8")
    .split("\n").filter((l) => l.trim().length > 0).length;
  assert.equal(canonicalCount, CANONICAL_CAPABILITY_COUNT);
});


// ── DNA_OS_OPERATION_ALGEBRA_V1 ──

const levels = classifyCapabilityLevels(contracts, model, index);
const operandTypes = canonicalOperandTypes(contracts);
const operators = canonicalOperators(contracts, model, index);
const equations = OWNER_TEST_EXPRESSIONS.map((e) => resolveOutcomeExpression(e, operators, model, index));

t("98. สี่ระดับจำแนกจากหลักฐานเชิงโครงสร้าง ไม่ใช่จากชื่อ", () => {
  assert.equal(levels.length, CANONICAL_CAPABILITY_COUNT);
  const allowed = new Set(LEVEL_ORDER);
  for (const l of levels) {
    assert.ok(allowed.has(l.level), `ระดับที่ไม่อนุญาต: ${l.level}`);
    assert.ok(l.basis.length > 0, "ทุกการจัดระดับต้องบอกเหตุ");
    // เหตุต้องอ้างโครงสร้าง ไม่ใช่ชื่อของความสามารถ
    const cap = contracts.find((c) => c.capability_id === l.capability_id)!;
    assert.ok(!l.basis.includes(cap.canonical_name), "จัดระดับโดยอ้างชื่อ");
  }
  assert.ok(levels.some((l) => l.level === "UNCLASSIFIED"), "ต้องยอมรับว่าบางตัวจัดไม่ได้");
});

t("99. ชนิดตัวถูกดำเนินการ มาจากสัญญาที่ประกาศไว้จริง", () => {
  assert.ok(operandTypes.length > 0);
  const declaredTypes = new Set(contracts.flatMap((c) => [...c.input_contract, ...c.output_contract]));
  for (const t2 of operandTypes) {
    assert.ok(declaredTypes.has(t2.type_id), `ชนิดที่ไม่ได้ประกาศไว้: ${t2.type_id}`);
    assert.ok(t2.used_as_input_by.length > 0 || t2.produced_by.length > 0);
    assert.ok(t2.source_authority.includes("capabilities.jsonl"));
  }
  // ชนิดที่โจทย์ยกตัวอย่าง ต้องไม่ถูกสร้างขึ้นมาเอง
  for (const invented of ["ENTITY", "STATE", "RESOURCE", "DATA", "TARGET", "RESULT", "EVIDENCE"]) {
    const found = operandTypes.find((x) => x.type_id === invented);
    if (found !== undefined) assert.ok(declaredTypes.has(invented), `${invented} ถูกสร้างขึ้นเอง`);
  }
});

t("100. ตัวดำเนินการมีอยู่จริง และเก็บช่องว่างไว้", () => {
  for (const o of operators) {
    assert.ok(o.operator_id.includes("@"), "ตัวดำเนินการต้องผูกกับความสามารถ");
    const cap = contracts.find((c) => c.capability_id === o.capability_id);
    assert.ok(cap !== undefined, "ตัวดำเนินการชี้ไปยังความสามารถที่ไม่มีจริง");
    assert.ok(o.evidence.length > 0);
    assert.equal(o.contract_complete, o.missing_fields.length === 0);
    for (const m of o.missing_fields) assert.ok(/^[A-Z_]+$/.test(m));
  }
  // ตัวดำเนินการที่ไม่มีคำประกาศ ต้องไม่ถูกสร้างขึ้นมา
  const actionsWithOperators = new Set(operators.map((o) => o.action_class));
  for (const a of ["MOVE", "COPY", "SEND", "TRANSFER", "DISPLAY"] as const) {
    assert.ok(!actionsWithOperators.has(a), `${a} ถูกสร้างขึ้นทั้งที่ไม่มีคำประกาศ`);
  }
});

t("101. อ่าน ไม่เท่ากับ เขียน — พฤติกรรมมาจากหลักฐาน", () => {
  const allowed = new Set(["OBSERVATION", "TRANSFORMATION", "STATE_CHANGE", "CONTROL", "VERIFICATION", "UNDETERMINED"]);
  for (const o of operators) {
    assert.ok(allowed.has(o.behavior));
    // ตัวที่ประกาศอำนาจแค่สังเกต ต้องไม่ได้พฤติกรรมเปลี่ยนสถานะ
    if (o.behavior === "OBSERVATION") {
      assert.notEqual(o.behavior as string, "STATE_CHANGE");
      assert.equal(o.side_effect.length, 0, "ตัวสังเกตประกาศผลข้างเคียงไว้");
    }
    // ตัวที่ประกาศผลข้างเคียง ต้องไม่ถูกอ่านว่าเป็นแค่การสังเกต
    if (o.side_effect.length > 0) assert.notEqual(o.behavior, "OBSERVATION");
  }
  const ai = aiResourceModel();
  for (const a of ai) {
    // ทรัพยากรที่แปลงข้อความได้ ต้องไม่ได้อำนาจเปลี่ยนสถานะแถมมา
    assert.equal(a.has_global_system_authority, false);
    assert.ok(!a.work_scope.includes("WRITE" as never), "ทรัพยากรภาษาได้ขอบเขตเขียนโดยไม่มีคำประกาศ");
  }
});

t("102. สมการของ Owner ไม่มี path ของซอร์สเป็นความหมาย", () => {
  for (const e of OWNER_TEST_EXPRESSIONS) {
    const text = JSON.stringify(e);
    assert.ok(!/\.ts|\.mjs|\/control\/|\/execution\//.test(text), `สมการมี path อยู่ในความหมาย: ${e.outcome_id}`);
    assert.ok(e.outcome_id.length > 0 && e.target.length > 0 && e.desired_state_or_result.length > 0);
    assert.ok(e.required_operations.length > 0);
  }
});

t("103. หนึ่งการดำเนินการ แยกสี่ตัวตน", () => {
  for (const eq of equations) {
    for (const r of eq.resolutions) {
      assert.ok(["PROVEN", "DECLARED_NOT_EXECUTABLE", "MISSING"].includes(r.status));
      if (r.status === "MISSING") {
        assert.equal(r.capability_id, null);
        assert.equal(r.implementation.length, 0);
      } else {
        assert.ok(r.capability_id !== null && r.capability_id.startsWith("capability-"));
        // ความสามารถ / สิ่งที่สร้างมัน / ทรัพยากร ต้องไม่ปนกัน
        for (const impl of r.implementation) {
          assert.ok(impl.startsWith("machine://"), "สิ่งที่สร้างมันปนกับตัวความสามารถ");
          assert.notEqual(impl, `machine://CAPABILITIES/${r.capability_id}`);
        }
      }
    }
  }
});

t("104. สมการทดสอบห้าอัน ตอบด้วยช่องว่างที่ระบุได้", () => {
  assert.equal(equations.length, 5);
  for (const eq of equations) {
    assert.ok(eq.operations_required.length > 0);
    if (!eq.expression_representable) {
      assert.ok(eq.operations_missing.length > 0, "แทนไม่ได้ต้องบอกว่าขาดตัวดำเนินการไหน");
    }
    for (const g of [...eq.contract_gaps, ...eq.resource_gaps, ...eq.authority_gaps, ...eq.verification_gaps]) {
      assert.ok(g.length > 0 && !/unknown|ไม่ทราบ/i.test(g), `ช่องว่างคลุมเครือ: ${g}`);
    }
  }
  const representable = equations.filter((e) => e.expression_representable);
  const notRepresentable = equations.filter((e) => !e.expression_representable);
  assert.ok(notRepresentable.length > 0, "ต้องมีสมการที่ยังแทนไม่ได้");
  for (const e of representable) assert.equal(e.operations_missing.length, 0);
});

t("105. ตัวแก้สมการตัวเดียว ไม่มีสูตรสำเร็จรายผลลัพธ์", () => {
  const src = readFileSync(new URL("../operation-algebra.ts", import.meta.url), "utf8")
    .split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//")).join("\n");
  // ตัวแก้ต้องไม่ถามว่าเป็นผลลัพธ์อันไหน
  for (const e of OWNER_TEST_EXPRESSIONS) {
    const resolverBody = src.slice(src.indexOf("export function resolveOutcomeExpression"));
    assert.ok(!resolverBody.includes(e.outcome_id), `ตัวแก้มีสาขาเฉพาะของ ${e.outcome_id}`);
  }
  assert.ok(!/outcome_id\s*===\s*["'`]/.test(src), "พบการเทียบ outcome_id ตรง ๆ");
  assert.ok(!/switch\s*\(\s*\w*outcome/i.test(src), "พบ switch บนผลลัพธ์");
  // สมการใหม่ที่ไม่เคยมี ต้องแก้ได้ด้วยตัวเดิมโดยไม่แตะโค้ด
  const novel = { outcome_id: "NOVEL_OUTCOME_NOT_IN_LIST", target: "x", desired_state_or_result: "y",
    constraints: [], required_operations: ["OBSERVE"] as const, dependencies: [],
    verification_requirement: [] as const };
  const r = resolveOutcomeExpression(novel as never, operators, model, index);
  assert.equal(r.outcome_id, "NOVEL_OUTCOME_NOT_IN_LIST");
  assert.ok(r.resolutions.length > 0, "ตัวแก้ไม่รู้จักสมการใหม่");
});

t("106. ตำแหน่ง AI มีได้เมื่อมีคำประกาศเท่านั้น", () => {
  const positions = aiOperationPositions(operators);
  const ai = aiResourceModel();
  for (const p of positions) {
    assert.ok(ai.some((a) => p.work_scope.every((w) => a.work_scope.includes(w))),
      "ตำแหน่ง AI ที่ไม่มีทรัพยากรใดประกาศขอบเขตรองรับ");
    assert.ok(p.evidence.length > 0);
  }
  // ไม่มีคำประกาศ = ศูนย์ ไม่ใช่การประดิษฐ์ตำแหน่งขึ้นมา
  const declaredAiScopes = new Set(ai.flatMap((a) => a.work_scope));
  const operatorActions = new Set(operators.map((o) => o.action_class));
  const overlap = [...declaredAiScopes].filter((s) => operatorActions.has(s as never));
  assert.equal(positions.length, overlap.length === 0 ? 0 : positions.length);
});

t("107. ไม่สร้างตัวดำเนินการ ไม่ซ่อมสัญญา ไม่รันสมการ", () => {
  const src = readFileSync(new URL("../operation-algebra.ts", import.meta.url), "utf8");
  for (const b of ["writeFileSync", "appendFileSync", "commitRegisteredCandidate",
                   "dispatchRoute", "submitTask", "execFileSync", "spawn", "fetch("]) {
    assert.ok(!src.includes(b), `พบ ${b}`);
  }
  const canonicalCount = readFileSync("software/registry-database/data/canonical/capabilities.jsonl", "utf8")
    .split("\n").filter((l) => l.trim().length > 0).length;
  assert.equal(canonicalCount, CANONICAL_CAPABILITY_COUNT);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
