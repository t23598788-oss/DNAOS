/**
 * หน้าที่: prove that the executable Owner-intent vocabulary is owned by
 * deterministic software, that a value outside it fails as its own boundary,
 * and that CAPABILITY_UNKNOWN keeps its original meaning (Owner, 2026-09-02).
 *
 * WHY IT EXISTS. The vocabulary lived in three unsynchronised places and
 * nothing validated it, so `LIST_CAPABILITIES` was offered to the model with no
 * consumer, and the prompt's own placeholder prose `"existing Core intent type"`
 * reached the runtime as a value five times — each reported as
 * CAPABILITY_UNKNOWN, which claims the capability could not be resolved. That
 * is a different failure from "software never agreed this word means anything",
 * and cases 5-8 below hold those two apart.
 *
 * Input: none.  Output: exit code 0 (all passed) or 1.
 * Dependency ที่อนุญาต: ../intent-contract, node built-ins.
 * สิ่งที่ห้ามแตะ: ห้ามเพิ่มค่าเข้าเทสต์นี้โดยไม่มีผู้บริโภคจริง และห้ามยอมรับ
 * ค่าที่โมเดลแต่งขึ้นว่าถูกต้อง.
 */
import { readFileSync } from "node:fs";
import { EXECUTABLE_INTENTS, INTENT_CONTRACT_FILE, NON_EXECUTABLE_INTENTS, classifyIntentType, operationForIntent } from "../intent-contract";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

// 1-4. every value the Owner's decision named as executable is accepted
for (const value of ["READ_REPOSITORY_STATE", "CAPABILITY_STATUS", "LIST_AVAILABLE_CAPABILITIES", "AGENT_WORK_REQUEST"]) {
  check(`${value} -> accepted by contract`, classifyIntentType(value) === "EXECUTABLE", `class=${classifyIntentType(value)}`);
}
check("INSPECT_RUNNING_PROCESS / INSPECT_LOCAL_RUNTIME / VERIFY_LOCAL_TESTS also executable",
  ["INSPECT_RUNNING_PROCESS", "INSPECT_LOCAL_RUNTIME", "VERIFY_LOCAL_TESTS"].every((v) => classifyIntentType(v) === "EXECUTABLE"));

// 5. the orphaned value is out, and was NOT aliased to the surviving one
check("5. LIST_CAPABILITIES -> NOT_IN_CONTRACT", classifyIntentType("LIST_CAPABILITIES") === "NOT_IN_CONTRACT", `class=${classifyIntentType("LIST_CAPABILITIES")}`);
check("5b. LIST_CAPABILITIES was removed, not aliased", operationForIntent("LIST_CAPABILITIES") === null && !EXECUTABLE_INTENTS.includes("LIST_CAPABILITIES"));

// 6. the prompt placeholder that leaked into the runtime five times
check("6. \"existing\" -> NOT_IN_CONTRACT", classifyIntentType("existing") === "NOT_IN_CONTRACT");
check("6b. the full placeholder prose is also rejected", classifyIntentType("existing Core intent type") === "NOT_IN_CONTRACT");

// 7. anything a model invents
for (const invented of ["DO_THE_THING", "read_repository_state", "", "  ", "OPEN_TIKTOK"]) {
  const cls = classifyIntentType(invented);
  if (cls !== "NOT_IN_CONTRACT") { check(`7. model-invented ${JSON.stringify(invented)} rejected`, false, `class=${cls}`); }
}
check("7. arbitrary model-created intent -> NOT_IN_CONTRACT",
  ["DO_THE_THING", "read_repository_state", "", "  ", "OPEN_TIKTOK"].every((v) => classifyIntentType(v) === "NOT_IN_CONTRACT"));
check("7b. non-string values rejected", [null, undefined, 42, {}].every((v) => classifyIntentType(v) === "NOT_IN_CONTRACT"));

// 8. UNKNOWN is a real semantic outcome, not an execution and not a contract failure
check("8. UNKNOWN -> NON_EXECUTABLE (its own path, not NOT_IN_CONTRACT)",
  classifyIntentType("UNKNOWN") === "NON_EXECUTABLE" && NON_EXECUTABLE_INTENTS.includes("UNKNOWN"));

// operation binding comes from the contract, not from a second table
check("operation binding read from the contract", operationForIntent("READ_REPOSITORY_STATE") === "READ_GIT" && operationForIntent("VERIFY_LOCAL_TESTS") === "RUN_TEST");
check("registry-read intents legitimately carry no operation", operationForIntent("CAPABILITY_STATUS") === null && operationForIntent("LIST_AVAILABLE_CAPABILITIES") === null);

// single source of truth: the prompt must not carry its own list any more
const runner = readFileSync("/Users/tam/Desktop/DNA-OS-INFRASTRUCTURE/control/owner-command-semantics/semantic-runner.py", "utf8");
check("prompt no longer hardcodes the vocabulary", !runner.includes("READ_REPOSITORY_STATE, INSPECT_RUNNING_PROCESS"));
// Only the prompt strings matter here; this file's own explanatory comments may
// name the removed value while explaining why it was removed.
const promptOnly = runner.split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n");
check("prompt no longer offers LIST_CAPABILITIES", !promptOnly.includes("LIST_CAPABILITIES"));
check("prompt placeholder-as-value removed", !runner.includes("existing Core intent type"));
check("prompt reads the same contract file", runner.includes("executable-intent-contract.json"));

const contract = JSON.parse(readFileSync(INTENT_CONTRACT_FILE, "utf8")) as { executable: Array<{ consumer: string }> };
check("every executable value names a real consumer", contract.executable.every((e) => typeof e.consumer === "string" && e.consumer.includes("/")));
check("exactly the seven decided executable values", EXECUTABLE_INTENTS.length === 7, EXECUTABLE_INTENTS.join(", "));

console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
