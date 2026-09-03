#!/usr/bin/env python3
# REGRESSION: runner ต้อง establish scroll target (preMove) ก่อน BOTH scroll ops + precondition + sandbox mx
import re, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
runner = open(os.path.join(ROOT, "control/computer-use-executor/tools/physical-acceptance-runner.ts")).read()
sandbox = open(os.path.join(ROOT, "control/computer-use-executor/sandbox/acceptance-sandbox.html")).read()
fail = 0
def chk(label, cond):
    global fail
    print(("PASS" if cond else "FAIL") + "  " + label); 
    if not cond: fail += 1
# scroll steps 6 และ 7 ต้องมี preMove: SCROLLPT
s6 = re.search(r'step\(6, "scroll".*?\)\)', runner, re.S)
s7 = re.search(r'step\(7, "scroll".*?\)\)', runner, re.S)
chk("step6 scroll มี preMove: SCROLLPT", bool(s6) and "preMove: SCROLLPT" in s6.group(0))
chk("step7 scroll มี preMove: SCROLLPT", bool(s7) and "preMove: SCROLLPT" in s7.group(0))
chk("step6 scroll มี scrollBounds", bool(s6) and "scrollBounds: SCROLL_B" in s6.group(0))
chk("step7 scroll มี scrollBounds", bool(s7) and "scrollBounds: SCROLL_B" in s7.group(0))
# precondition: SCROLL_TARGET inside scrollable + DOCUMENT_SCROLLABLE
chk("runner มี precondition SCROLL_TARGET_INSIDE_SCROLLABLE", "SCROLL_TARGET_INSIDE_SCROLLABLE" in runner)
chk("runner มี precondition DOCUMENT_SCROLLABLE (maxScrollY)", "DOCUMENT_SCROLLABLE" in runner and "maxScrollY" in runner)
# preMove dispatch pointer_move ก่อน main op
chk("runner dispatch pointer_move ก่อน (preMove block)", "acc-${n}-premove-" in runner and 'writeWO(mvId, "pointer_move"' in runner)
# SCROLLPT อยู่ในโซนระหว่าง clickband กับ box
chk("SCROLLPT คำนวณจาก CLICK_B.y1..BOX_B.y0", "BOX_B.y0 - CLICK_B.y1" in runner)
# sandbox expose mx (maxScrollY)
chk("sandbox encode mx (maxScrollY) ใน title", "'|mx='+mx" in sandbox and "scrollHeight-de.clientHeight" in sandbox)
print(("\nALL PASS" if fail == 0 else f"\n{fail} FAILED") + " (scroll-targeting regression)")
sys.exit(1 if fail else 0)
