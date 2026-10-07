/**
 * หน้าที่: ต่อสายจริงระหว่างชิปด้วย connect() แล้วบันทึกลง chip-connections.jsonl
 * ไม่มีการ hardcode สาย — ทุกเส้นต้องผ่านการตรวจหกข้อก่อนถูกเขียน
 */
import { join } from "node:path";
import { connect, recordConnection, loadInterface, CONNECTION_LOG,
         type ChipInterface, type ConnectionRequest } from "./contract";

const DATA = join(__dirname, "..", "data");
const c1: ChipInterface = loadInterface(join(DATA, "chip-external-interface.json"));
const c2: ChipInterface = loadInterface(join(DATA, "chip2-external-interface.json"));
const reg = [c1, c2];
const P = (i: ChipInterface, id: string) => i.PORTS.find((p) => p.PORT_ID === id)!;

const requests: ConnectionRequest[] = [
  { source_chip_id: c1.CHIP_ID, source_port_id: "port:control/agent-gateway#runAgentWorkOrder",
    target_chip_id: c2.CHIP_ID, target_port_id: `port:${c2.CHIP_ID}#workOrderIn`,
    signal_type: "COMMAND",
    schema_id: String(P(c1, "port:control/agent-gateway#runAgentWorkOrder").SCHEMA.schema_id),
    interface_version: "1.0.0" },
  { source_chip_id: c2.CHIP_ID, source_port_id: `port:${c2.CHIP_ID}#agentResultOut`,
    target_chip_id: c1.CHIP_ID, target_port_id: "port:control/agent-gateway#runCorrectiveLoop",
    signal_type: "RESULT",
    schema_id: String(P(c2, `port:${c2.CHIP_ID}#agentResultOut`).SCHEMA.schema_id),
    interface_version: "1.0.0" },
];
for (const req of requests) {
  const r = connect(req, reg);
  console.log(`  ${r.accepted ? "ACCEPTED" : "REJECTED"}  ${req.source_port_id} -> ${req.target_port_id}`);
  console.log(`     reason=${r.reason}  checks=${JSON.stringify(r.checks)}`);
  recordConnection(r);
}
console.log(`  log: ${CONNECTION_LOG}`);
