#!/usr/bin/env bash
# verify-marketing.sh — READ-ONLY verification of the public marketing surface.
#
# Usage: ./verify-marketing.sh [BASE_URL]
#   BASE_URL omitted -> $NEXT_PUBLIC_APP_URL -> http://localhost:3000
#   Never point this at production without passing BASE_URL explicitly.
#
# Tools: curl + grep. python3 is used for exactly one thing — parsing JSON-LD,
# because "is this valid JSON containing @type X" cannot be answered by grep.
# No writes, no DB access, no app code changes.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

BASE="${1:-${NEXT_PUBLIC_APP_URL:-http://localhost:3000}}"
BASE="${BASE%/}"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0; WARN=0; FAIL=0
pass() { PASS=$((PASS+1)); printf '| %-5s | %-34s | %-34s | %s |\n' PASS "$1" "$2" "$3"; }
warn() { WARN=$((WARN+1)); printf '| %-5s | %-34s | %-34s | %s |\n' WARN "$1" "$2" "$3"; }
fail() { FAIL=$((FAIL+1)); printf '| %-5s | %-34s | %-34s | %s |\n' FAIL "$1" "$2" "$3"; }

http() { # url outfile -> prints status code
  curl -sS -o "$2" -w '%{http_code}' --max-time 25 "$1" 2>/dev/null || echo "000"
}

printf 'BASE_URL: %s\n\n' "$BASE"
printf '| %-5s | %-34s | %-34s | %s |\n' RESULT CHECK TARGET EVIDENCE
printf '|%s|%s|%s|%s|\n' "-------" "------------------------------------" "------------------------------------" "---------------------------------------------"

ROUTES="$(python3 -c 'import json;print("\n".join(json.load(open("registry/permissions.json"))["public_routes"]))' 2>/dev/null)"
[ -n "$ROUTES" ] || ROUTES=$'/\n/login\n/register\n/products\n/products/catalog\n/solutions\n/marketplace\n/ai-services\n/report\n/start\n/examples\n/playground\n/observer\n/download\n/install'
ROUTE_COUNT="$(printf '%s\n' "$ROUTES" | grep -c .)"

# ---------------------------------------------------------------- A. robots
code="$(http "$BASE/robots.txt" "$TMP/robots.txt")"
if [ "$code" != "200" ]; then
  fail "A robots.txt" "GET /robots.txt" "HTTP $code"
else
  missing=""
  for d in /admin /business /partner /user /account /workspace /api/ /auth/ /liff /oauth; do
    grep -qx "Disallow: $d" "$TMP/robots.txt" || missing="$missing $d"
  done
  if [ -n "$missing" ]; then
    fail "A robots.txt disallow" "/robots.txt" "missing:$missing"
  else
    pass "A robots.txt disallow" "/robots.txt" "all 10 private prefixes disallowed"
  fi

  allow_n=0; allow_missing=""
  while IFS= read -r r; do
    [ -n "$r" ] || continue
    if grep -qxF "Allow: $r" "$TMP/robots.txt"; then allow_n=$((allow_n+1)); else allow_missing="$allow_missing $r"; fi
  done <<< "$ROUTES"
  if [ -n "$allow_missing" ]; then
    fail "A robots.txt allow" "registry/permissions.json" "not allowed:$allow_missing"
  else
    pass "A robots.txt allow" "$ROUTE_COUNT public routes" "$allow_n/$ROUTE_COUNT match registry"
  fi
fi

# --------------------------------------------------------------- B. sitemap
code="$(http "$BASE/sitemap.xml" "$TMP/sitemap.xml")"
if [ "$code" != "200" ] || ! grep -q '<urlset' "$TMP/sitemap.xml"; then
  fail "B sitemap.xml" "GET /sitemap.xml" "HTTP $code / no <urlset>"
else
  total="$(grep -o '<loc>' "$TMP/sitemap.xml" | wc -l | tr -d ' ')"
  prod="$(grep -o '</products/' "$TMP/sitemap.xml" | wc -l | tr -d ' ')"
  if [ "$total" -eq 0 ]; then
    fail "B sitemap.xml urls" "/sitemap.xml" "0 <loc> (is NEXT_PUBLIC_APP_URL set?)"
  else
    pass "B sitemap.xml urls" "/sitemap.xml" "$total <loc>, $prod product url(s)"
    if [ "$prod" -eq 0 ]; then
      warn "B sitemap products" "/sitemap.xml" "0 product urls — nothing published in publication_records"
    fi
  fi
fi

# ------------------------------------------------------------------- D+B/C
SLUG="$(grep -oE '<loc>[^<]*/products/[a-z0-9-]+</loc>' "$TMP/sitemap.xml" 2>/dev/null \
  | sed -E 's#.*/products/([a-z0-9-]+)<.*#\1#' | grep -vx 'catalog' | head -1)"
if [ -z "$SLUG" ]; then
  SLUG="$(curl -sS --max-time 20 "$BASE/api/public/products?pageSize=1" 2>/dev/null \
    | python3 -c 'import json,sys;d=json.load(sys.stdin);print((d.get("items") or [{}])[0].get("slug",""))' 2>/dev/null)"
fi

# ------------------------------------------------------------- C. og/twitter
c_fail_routes=""; c_missing_tags=""; c_legacy=""
while IFS= read -r r; do
  [ -n "$r" ] || continue
  f="$TMP/page$(printf '%s' "$r" | tr '/' '_').html"
  code="$(http "$BASE$r" "$f")"
  if [ "$code" != "200" ]; then c_fail_routes="$c_fail_routes $r($code)"; continue; fi
  miss=""
  for pat in '<meta property="og:title"' '<meta property="og:description"' '<meta property="og:image"' '<meta name="twitter:card"' '<link rel="canonical"'; do
    grep -qF "$pat" "$f" || miss="$miss ${pat:1:14}"
  done
  [ -z "$miss" ] || c_missing_tags="$c_missing_tags $r:[$miss ]"
  ot="$(grep -oE '<meta property="og:title" content="[^"]*"' "$f" | head -1)"
  case "$ot" in *"Dead Board"*) c_legacy="$c_legacy $r";; esac
done <<< "$ROUTES"

if [ -n "$c_fail_routes" ]; then
  fail "C page fetch" "$ROUTE_COUNT public routes" "non-200:$c_fail_routes"
else
  pass "C page fetch" "$ROUTE_COUNT public routes" "all HTTP 200"
fi
if [ -n "$c_legacy" ]; then
  fail "C legacy og:title" "og:title" "still \"DNA OS — Dead Board\":$c_legacy"
else
  pass "C legacy og:title" "og:title" "no 'Dead Board' on any public route"
fi
if [ -n "$c_missing_tags" ]; then
  fail "C og/twitter/canonical" "$ROUTE_COUNT public routes" "missing:$c_missing_tags"
else
  pass "C og/twitter/canonical" "$ROUTE_COUNT public routes" "og:title/desc/image + twitter:card + canonical"
fi

# ------------------------------------------------------------- D. JSON-LD
jsonld() { # file mode -> prints OK reason | FAIL reason
  python3 - "$1" "$2" <<'PY'
import json, sys
path, mode = sys.argv[1], sys.argv[2]
html = open(path, encoding="utf-8", errors="replace").read()
import re
# Only real <script type="application/ld+json"> blocks. A bare substring search
# also matches the escaped copy Next embeds in its flight payload, which is not
# a JSON-LD block at all.
blocks = [m.group(1).strip() for m in
          re.finditer(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', html, re.S)]
if not blocks:
    print("FAIL no ld+json block"); sys.exit()
types = []
for b in blocks:
    try:
        data = json.loads(b)
    except Exception as e:
        print(f"FAIL invalid JSON-LD ({e.__class__.__name__})"); sys.exit()
    stack = [data]
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            t = node.get("@type")
            if isinstance(t, str): types.append(t)
            elif isinstance(t, list): types.extend(x for x in t if isinstance(x, str))
            stack.extend(node.values())
        elif isinstance(node, list):
            stack.extend(node)
if mode == "home":
    need = {"Organization", "WebSite"}
    missing = need - set(types)
    print("FAIL missing %s" % ",".join(sorted(missing)) if missing else "OK Organization+WebSite in @graph")
else:
    if not ({"Product", "Service"} & set(types)):
        print("FAIL no Product/Service"); sys.exit()
    kind = "Product" if "Product" in types else "Service"
    print("OK %s%s" % (kind, " + Offer" if "Offer" in types else ""))
PY
}

code="$(http "$BASE/" "$TMP/home.html")"
if [ "$code" = "200" ]; then
  res="$(jsonld "$TMP/home.html" home)"
  case "$res" in OK*) pass "D JSON-LD /" "/" "${res#OK }";; *) fail "D JSON-LD /" "/" "${res#FAIL }";; esac
else
  fail "D JSON-LD /" "/" "HTTP $code"
fi

if [ -n "$SLUG" ]; then
  code="$(http "$BASE/products/$SLUG" "$TMP/product.html")"
  if [ "$code" = "200" ]; then
    res="$(jsonld "$TMP/product.html" product)"
    case "$res" in OK*) pass "D JSON-LD product" "/products/$SLUG" "${res#OK }";; *) fail "D JSON-LD product" "/products/$SLUG" "${res#FAIL }";; esac
  else
    fail "D JSON-LD product" "/products/$SLUG" "HTTP $code"
  fi
else
  warn "D JSON-LD product" "/products/<slug>" "no published product to sample (0 in sitemap)"
fi

# ------------------------------------------------------------------ E. GA4
gtag_hits="$(grep -o 'googletagmanager' "$TMP/home.html" 2>/dev/null | wc -l | tr -d ' ')"
if [ -n "${NEXT_PUBLIC_GA_ID:-}" ]; then
  if [ "$gtag_hits" -gt 0 ]; then pass "E GA4" "/" "NEXT_PUBLIC_GA_ID set, gtag script present"; else fail "E GA4" "/" "NEXT_PUBLIC_GA_ID set but no gtag script"; fi
else
  if [ "$gtag_hits" -eq 0 ]; then pass "E GA4" "/" "NEXT_PUBLIC_GA_ID unset, 0 gtag occurrences"; else fail "E GA4" "/" "NEXT_PUBLIC_GA_ID unset but $gtag_hits gtag occurrence(s)"; fi
fi

# -------------------------------------------------------------- F. catalog
code="$(http "$BASE/products/catalog" "$TMP/catalog.html")"
if [ "$code" != "200" ]; then
  fail "F catalog" "/products/catalog" "HTTP $code"
elif grep -q 'ยังไม่มีรายการที่ได้รับอนุญาตเผยแพร่ในขณะนี้' "$TMP/catalog.html"; then
  warn "F catalog" "/products/catalog" "renders empty state (0 published records)"
else
  n="$(grep -oE 'href="/products/[a-z0-9-]+"' "$TMP/catalog.html" | sort -u | wc -l | tr -d ' ')"
  pass "F catalog" "/products/catalog" "$n item link(s) rendered"
fi

printf '\n%d passed, %d warnings, %d failures\n' "$PASS" "$WARN" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
