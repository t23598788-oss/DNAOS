import re, json, sys
raw = open(sys.argv[1], encoding="utf-8").read()
parts = re.split(r"^(/admin/\S+) \{", raw, flags=re.M)[1:]
for i in range(0, len(parts), 2):
    name = parts[i]
    d = json.loads("{" + parts[i + 1])
    L = d["launcher"]; H = d["headings"]; F = d["formFirst"]; T = d["table"]
    if L is None:
        print("==", name, "-> NOT LOGGED IN / null")
        continue
    def ov(b):
        if b is None:
            return None
        return not (b["right"] < L["x"] or b["x"] > L["x"] + L["w"] or b["bottom"] < L["y"] or b["y"] > L["y"] + L["h"])
    print("==", name, "| header:", repr(d["titleText"]), "| padLeft:", d.get("contentPadLeft"), "| contentRect:", d.get("contentRect"), "| overflowX:", d["hScroll"]["overflowX"])
    print("   launcher:", L, "| title:", T)
    for h in H:
        print("   heading", repr(h["text"]), h["box"], "overlap=", ov(h["box"]))
    print("   formFirst", F, "overlap=", ov(F))
    if T:
        print("   table x,w,right,y:", T["x"], T["w"], T["right"], T["y"], "within_frame=", T["right"] <= 1440)
    else:
        print("   table none")
