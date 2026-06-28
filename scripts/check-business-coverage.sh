#!/bin/bash

echo "=== DNA OS Business Coverage ==="

REGISTRY="lib/registry/business-coverage.json"

if [ ! -f "$REGISTRY" ]; then
  echo "ERROR: $REGISTRY not found"
  exit 1
fi

COVERED=0
PARTIAL=0
NOT_COVERED=0
TOTAL=0

echo ""

# Parse each domain
for status in covered partial not_covered; do
  DOMAINS=$(grep -B1 "\"$status\"" "$REGISTRY" | grep '"label"' | sed 's/.*"label": "//;s/".*//')

  if [ "$status" = "covered" ]; then
    SYMBOL="OK"
  elif [ "$status" = "partial" ]; then
    SYMBOL="PARTIAL"
  else
    SYMBOL="MISSING"
  fi

  echo "$DOMAINS" | while IFS= read -r domain; do
    [ -z "$domain" ] && continue
    echo "  $SYMBOL  $domain"
  done

  COUNT=$(grep -c "\"$status\"" "$REGISTRY" 2>/dev/null || echo "0")
  TOTAL=$((TOTAL + COUNT))

  case $status in
    covered) COVERED=$COUNT ;;
    partial) PARTIAL=$COUNT ;;
    not_covered) NOT_COVERED=$COUNT ;;
  esac
done

TOTAL=$(grep -c '"status"' "$REGISTRY" 2>/dev/null || echo "0")
COVERED=$(grep -c '"covered"' "$REGISTRY" 2>/dev/null || echo "0")
PARTIAL=$(grep -c '"partial"' "$REGISTRY" 2>/dev/null || echo "0")
NOT_COVERED=$(grep -c '"not_covered"' "$REGISTRY" 2>/dev/null || echo "0")

if [ $TOTAL -gt 0 ]; then
  COVERAGE_PCT=$(( (COVERED * 100 + PARTIAL * 50) / TOTAL ))
else
  COVERAGE_PCT=0
fi

echo ""
echo "  Total domains:  $TOTAL"
echo "  Covered:        $COVERED"
echo "  Partial:        $PARTIAL"
echo "  Not covered:    $NOT_COVERED"
echo "  Coverage:       $COVERAGE_PCT%"
echo ""

# List gaps
GAPS=$(grep '"gap"' "$REGISTRY" | sed 's/.*"gap": "//;s/".*//')
if [ -n "$GAPS" ]; then
  echo "--- Business Gaps ---"
  echo "$GAPS" | while IFS= read -r gap; do
    [ -z "$gap" ] && continue
    echo "  - $gap"
  done
fi

echo ""
echo "Business coverage check complete"
