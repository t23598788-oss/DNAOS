#!/usr/bin/env python3
# CALIBRATOR_BLOB regression — deterministic บน screenshot จริงของ diagnosis run 1788244866695
# พิสูจน์ largest-blob แก้ boxY จาก 299 (พิษ) → ~516 (ในกรอบ drag box จริง)
import subprocess, json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
FRAME = os.path.join(ROOT, "connections/os-ui/data/screenshots/screenshot-1788244810366-5hyz6f.png")
CAL = os.path.join(ROOT, "control/computer-use-executor/tools/calibrate-sandbox.py")
fail = 0
def chk(label, cond):
    global fail
    print(("PASS" if cond else "FAIL") + "  " + label)
    if not cond: fail += 1
if not os.path.exists(FRAME):
    print("SKIP  frame ไม่พบ (screenshot ถูกลบ) — logic ทดสอบใน verifier.test.ts แล้ว"); sys.exit(0)
o = json.loads(subprocess.run(["python3", CAL, FRAME, "1440", "900"], capture_output=True, text=True).stdout)
bb = o.get("boxBounds", {})
chk(f"boxY largest-blob = {o.get('boxY')} อยู่ใน 471-562 (ไม่ใช่ 299 พิษ)", 471 <= o.get("boxY", 0) <= 562)
chk("drag point (boxX,boxY) inside boxBounds", bb.get("y0",1e9) <= o.get("boxY",0) <= bb.get("y1",-1) and bb.get("x0",1e9) <= o.get("boxX",0) <= bb.get("x1",-1))
chk("OLD boxY=299 อยู่นอก boxBounds จริง (ยืนยันบั๊กเดิม)", not (bb.get("y0",1e9) <= 299 <= bb.get("y1",-1)))
cb = o.get("clickBounds", {})
chk("click point (cleanX,clickY) inside clickBounds", cb.get("x0",1e9) <= o.get("cleanX",0) <= cb.get("x1",-1) and cb.get("y0",1e9) <= o.get("clickY",0) <= cb.get("y1",-1))
print(("\nALL PASS" if fail == 0 else f"\n{fail} FAILED") + f" (calibrator blob regression)")
sys.exit(1 if fail else 0)
