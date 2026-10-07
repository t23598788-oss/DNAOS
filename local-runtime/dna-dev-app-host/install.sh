#!/bin/bash
# หน้าที่: the authorized install boundary — copies the BUILT DNA DEV.app to the
# Desktop and PROVES the installed bytes equal the built bytes. Refuses to
# install anything it did not just verify.
#
# This is the only sanctioned way the Desktop artifact is created. The Desktop
# bundle is an installed artifact; canonical source is this folder.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_APP="$DIR/build/DNA DEV.app"
MANIFEST="$DIR/build/build-manifest.json"
DEST_DIR="${DNA_DEV_INSTALL_DIR:-$HOME/Desktop}"
DEST_APP="$DEST_DIR/DNA DEV.app"

[ -d "$SRC_APP" ] || { echo "install: FAILED — no built artifact. Run ./build.sh first." >&2; exit 1; }
[ -f "$MANIFEST" ] || { echo "install: FAILED — no build manifest." >&2; exit 1; }

BUILD_ID="$(sed -n 's/.*"build_id": "\([^"]*\)".*/\1/p' "$MANIFEST" | head -1)"
built_launcher="$(sed -n 's/.*"artifact_launcher_sha256": "\([^"]*\)".*/\1/p' "$MANIFEST" | head -1)"
built_bundle="$(sed -n 's/.*"artifact_bundle_sha256": "\([^"]*\)".*/\1/p' "$MANIFEST" | head -1)"

# Preserve whatever is currently installed so an install is reversible.
if [ -d "$DEST_APP" ]; then
  BACKUP="$DEST_DIR/DNA DEV.app.superseded-$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$DEST_APP" "$BACKUP"
  echo "previous artifact preserved: $BACKUP"
fi

cp -R "$SRC_APP" "$DEST_APP"
xattr -cr "$DEST_APP" 2>/dev/null || true

# --- recompute from the INSTALLED bytes, never copied from the manifest ---
inst_launcher="$(shasum -a 256 "$DEST_APP/Contents/MacOS/launcher" | awk '{print $1}')"
inst_bundle="$(cd "$DEST_APP" && find . -type f -print0 | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | awk '{print $1}')"

MATCH="false"
if [ "$inst_launcher" = "$built_launcher" ] && [ "$inst_bundle" = "$built_bundle" ]; then MATCH="true"; fi
INSTALL_ID="install-$(date -u +%Y%m%dT%H%M%SZ)-$(head -c 6 /dev/urandom | xxd -p)"

cat > "$DIR/build/install-record.json" <<REC
{
  "install_id": "$INSTALL_ID",
  "build_id": "$BUILD_ID",
  "installed_path": "$DEST_APP",
  "desktop_launcher_sha256": "$inst_launcher",
  "desktop_bundle_sha256": "$inst_bundle",
  "built_launcher_sha256": "$built_launcher",
  "built_bundle_sha256": "$built_bundle",
  "provenance_match": $MATCH,
  "installed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
REC

echo "INSTALL_ID            $INSTALL_ID"
echo "installed             $DEST_APP"
echo "built  launcher sha   $built_launcher"
echo "instal launcher sha   $inst_launcher"
echo "built  bundle   sha   $built_bundle"
echo "instal bundle   sha   $inst_bundle"
echo "PROVENANCE_MATCH      $MATCH"
[ "$MATCH" = "true" ] || { echo "install: FAILED — installed bytes do not match built bytes" >&2; exit 1; }
