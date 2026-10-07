#!/bin/bash
# หน้าที่: assembles the real VoiceCommandHost.app bundle — compiles
# main.swift, places Info.plist, code-signs (ad-hoc, stable
# CFBundleIdentifier so TCC's per-app permission record persists across
# rebuilds using the same identifier). No Xcode project — a single
# swiftc invocation plus manual Contents/ layout, matching this repo's
# established "minimal glue, no heavy new toolchain" convention.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$DIR/VoiceCommandHost.app"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"

swiftc "$DIR/main.swift" -o "$APP/Contents/MacOS/VoiceCommandHost"
cp "$DIR/Info.plist" "$APP/Contents/Info.plist"

xattr -cr "$APP" # codesign refuses a bundle carrying resource-fork/Finder-info xattrs (real, hit during Discovery)
codesign --sign - --force --identifier com.dnaos.voice-command-host2 "$APP"

echo "built: $APP"
codesign -dv "$APP" 2>&1 | head -5
