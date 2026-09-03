/** พิสูจน์ว่า connect() ปฏิเสธสายผิดขาจริง และรับเฉพาะคู่ที่ถูกต้อง */
import { connect, loadInterface, REJECT_REASON, type ChipInterface, type ConnectionRequest }
  from "../contract";

const iface = loadInterface();
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, e = "") => { if (c) { pass++; console.log(`  ok   ${n}`); }
  else { fail++; console.log(`  FAIL ${n} ${e}`); } };

const P = (id: string) => iface.PORTS.find((p) => p.PORT_ID === id)!;
const OUT_EVENT = "port:control/owner-backbone#emitSystemEvent";
const OUT_AGENT = "port:control/agent-gateway#runAgentWorkOrder";
const IN_CMD = "port:control/owner-command#submitOwnerCommand";

// registry ทดสอบสำหรับ "ปลายทาง" — ไม่ได้สร้าง chip 2 ในกราฟจริง
const peer: ChipInterface = {
  interface_version: "1.0.0", CHIP_ID: "chip:test-peer",
  EXTERNAL_INPUT_PORTS: ["port:test/peer#acceptEvent"],
  EXTERNAL_OUTPUT_PORTS: ["port:test/peer#sendCommand"],
  PORTS: [
    { ...P(OUT_EVENT), CHIP_ID: "chip:test-peer", PORT_ID: "port:test/peer#acceptEvent",
      DIRECTION: "IN", POLICY_BOUNDARY: "test-peer accepts SystemEvent" },
    { ...P(IN_CMD), CHIP_ID: "chip:test-peer", PORT_ID: "port:test/peer#sendCommand",
      DIRECTION: "OUT" },
  ],
};
const reg = [iface, peer];
const req = (o: Partial<ConnectionRequest>): ConnectionRequest => ({
  source_chip_id: iface.CHIP_ID, source_port_id: OUT_EVENT,
  target_chip_id: "chip:test-peer", target_port_id: "port:test/peer#acceptEvent",
  signal_type: "EVENT", schema_id: String(P(OUT_EVENT).SCHEMA.schema_id),
  interface_version: "1.0.0", ...o });

console.log("— คู่ที่ถูกต้อง —");
{
  const r = connect(req({}), reg);
  ok("OUT(EVENT) -> IN(EVENT) schema เดียวกัน = ACCEPTED", r.accepted, r.reason);
  ok("มี connection_id", !!r.connection_id);
  ok("มี binding ทั้งสองฝั่ง", !!r.source_binding && !!r.target_binding);
  ok("ตรวจครบหกข้อ", Object.keys(r.checks).length === 6 && Object.values(r.checks).every(Boolean));
  ok("คำขอเดิมได้ connection_id เดิม", connect(req({}), reg).connection_id === r.connection_id);
}

console.log("— ต่อผิดขา —");
{
  ok("IN -> IN ถูกปฏิเสธ", connect(req({ source_port_id: IN_CMD }), reg).reason
     === REJECT_REASON.DIRECTION_INCOMPATIBLE);
  ok("OUT -> OUT ถูกปฏิเสธ", connect(req({ target_port_id: "port:test/peer#sendCommand" }), reg).reason
     === REJECT_REASON.DIRECTION_INCOMPATIBLE);
  ok("ต่อภายในชิปเดียวกันถูกปฏิเสธ", connect(req({ target_chip_id: iface.CHIP_ID,
     target_port_id: IN_CMD }), reg).reason === REJECT_REASON.SAME_CHIP);
  ok("port ที่ไม่มีอยู่ ถูกปฏิเสธ", connect(req({ target_port_id: "port:test/peer#nope" }), reg).reason
     === REJECT_REASON.TARGET_PORT_NOT_FOUND);
}

console.log("— schema / version / signal —");
{
  ok("schema คนละตัว ถูกปฏิเสธ", connect(req({ source_port_id: OUT_AGENT,
     signal_type: "COMMAND", schema_id: String(P(OUT_AGENT).SCHEMA.schema_id) }), reg).reason
     === REJECT_REASON.SCHEMA_INCOMPATIBLE);
  ok("schema_id ในคำขอไม่ตรงขา ถูกปฏิเสธ",
     connect(req({ schema_id: "dna-os/made-up@9" }), reg).reason === REJECT_REASON.SCHEMA_INCOMPATIBLE);
  ok("interface_version major ต่างกัน ถูกปฏิเสธ",
     connect(req({ interface_version: "2.0.0" }), reg).reason === REJECT_REASON.VERSION_INCOMPATIBLE);
  ok("signal_type ไม่ตรง ถูกปฏิเสธ",
     connect(req({ signal_type: "DATA" }), reg).reason === REJECT_REASON.SIGNAL_TYPE_MISMATCH);
}

console.log("— schema UNKNOWN ต้องไม่ถูกปล่อยผ่าน —");
{
  const unknownPeer: ChipInterface = { ...peer,
    PORTS: [{ ...peer.PORTS[0], SCHEMA: { schema_id: "UNKNOWN" } }] };
  ok("ปลายทาง schema UNKNOWN = ปฏิเสธ",
     connect(req({}), [iface, unknownPeer]).reason === REJECT_REASON.SCHEMA_UNKNOWN);
}

console.log("— policy —");
{
  const noPolicy: ChipInterface = { ...peer,
    PORTS: [{ ...peer.PORTS[0], POLICY_BOUNDARY: "UNKNOWN" }] };
  ok("ปลายทาง POLICY_BOUNDARY UNKNOWN = ปฏิเสธ",
     connect(req({}), [iface, noPolicy]).reason === REJECT_REASON.POLICY_DENIED);
}

console.log("— ไม่มีสายครึ่งเดียว —");
{
  const bad = connect(req({ signal_type: "DATA" }), reg);
  ok("ถูกปฏิเสธแล้วไม่มี binding ค้าง",
     bad.source_binding === null && bad.target_binding === null && bad.connection_id === "");
}

console.log(`\nPASS ${pass}  FAIL ${fail}`);
process.exit(fail === 0 ? 0 : 1);
