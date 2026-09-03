#!/usr/bin/env python3
# REGRESSION: wheel instrumentation — passive observe เท่านั้น + encode/parse ถูก + ไม่ขวาง scroll
import re, os, sys, subprocess, json
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sandbox = open(os.path.join(ROOT, "control/computer-use-executor/sandbox/acceptance-sandbox.html")).read()
fail = 0
def chk(label, cond):
    global fail
    print(("PASS" if cond else "FAIL") + "  " + label)
    if not cond: fail += 1
# ดึงเฉพาะ handler ของ wheel
m = re.search(r"addEventListener\('wheel',\((.*?)\},\{passive:true\}\)", sandbox, re.S)
chk("มี window 'wheel' listener แบบ {passive:true}", bool(m))
handler = m.group(0) if m else ""
chk("handler เพิ่ม wheelCount (wheelCount++)", "wheelCount++" in handler)
chk("handler บันทึก deltaY/deltaMode/target", "e.deltaY" in handler and "e.deltaMode" in handler and "e.target" in handler)
# passive-only: ห้ามมี preventDefault/stopPropagation/scrollTo/scrollBy ใน handler
for bad in ["preventDefault", "stopPropagation", "scrollTo", "scrollBy"]:
    chk(f"handler ไม่เรียก {bad} (passive observe)", bad not in handler)
# title encode wc/wdy/wdm/wt
chk("title encode wc/wdy/wdm/wt", all(t in sandbox for t in ["'|wc='+wheelCount", "'|wdy='+wdy", "'|wdm='+wdm", "'|wt='+wt"]))
# scroll listener เดิมยังอยู่ (ไม่แตะ)
chk("scroll listener เดิมยังอยู่", "addEventListener('scroll'" in sandbox)
# parse: จำลอง title แล้ว parse ด้วย logic เดียวกับ readState → distinguish A/B/C
def parse(title):
    kv={}
    for part in title.split("|"):
        i=part.find("=")
        if i>0: kv[part[:i]]=part[i+1:]
    return {"wc":int(kv.get("wc",0)),"sy":int(kv.get("sy",0))}
A=parse("DNAOS|sy=0|wc=0"); B=parse("DNAOS|sy=0|wc=1"); C=parse("DNAOS|sy=600|wc=1")
def classify(before,after):
    if after["wc"]==before["wc"]: return "A_NO_WHEEL_RECEIVED"
    if after["sy"]==before["sy"]: return "B_WHEEL_RECEIVED_BUT_NO_SCROLL"
    return "C_WHEEL_RECEIVED_AND_SCROLLED"
before=parse("DNAOS|sy=0|wc=0")
chk("classify A: wc 0->0 => NO_WHEEL_RECEIVED", classify(before,A)=="A_NO_WHEEL_RECEIVED")
chk("classify B: wc 0->1 sy 0->0 => WHEEL_BUT_NO_SCROLL", classify(before,B)=="B_WHEEL_RECEIVED_BUT_NO_SCROLL")
chk("classify C: wc 0->1 sy 0->600 => WHEEL_AND_SCROLLED", classify(before,C)=="C_WHEEL_RECEIVED_AND_SCROLLED")
print(("\nALL PASS" if fail==0 else f"\n{fail} FAILED")+" (wheel instrumentation regression)")
sys.exit(1 if fail else 0)
