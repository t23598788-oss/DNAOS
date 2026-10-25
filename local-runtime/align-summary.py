import json, re

raw = open("/tmp/align-e2e.txt", encoding="utf-8").read()
parts = re.split(r"\n(?=/admin/)", raw)

def overlap(a, b):
    if not a or not b:
        return None
    return not (a["right"] <= b["x"] or b["right"] <= a["x"] or a["bottom"] <= b["y"] or b["bottom"] <= a["y"])

for chunk in parts:
    m = re.match(r"(/admin/\S+)", chunk)
    if not m:
        continue
    route = m.group(1)
    start = chunk.find("{")
    depth = 0
    end = None
    for i, ch in enumerate(chunk[start:], start):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end is None:
        print(route, "INCOMPLETE")
        continue
    d = json.loads(chunk[start:end])
    L = d.get("launcher"); T = d.get("title"); C = d.get("content")
    print(route)
    print("  launcher:", L, "title:", T)
    if C:
        print("  content x/w:", C["x"], C["w"], "padLeft:", d.get("contentPadLeft"), "overflowX:", d.get("hScroll", {}).get("overflowX"))
    print("  launcher^title:", overlap(L, T), "| launcher^content:", overlap(L, C), "| title^content:", overlap(T, C))
    for h in d.get("headings", []):
        print("  heading:", h.get("text"), "box:", h.get("box"), "^launcher:", overlap(L, h.get("box")))
    tb = d.get("table")
    if tb:
        print("  table x/right/w:", tb.get("x"), tb.get("right"), tb.get("w"), "inside 1440:", tb.get("right", 0) <= 1440)
