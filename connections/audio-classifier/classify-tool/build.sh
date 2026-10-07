#!/bin/bash
# หน้าที่: compile ./main.swift into a real, local binary — same "plain
# swiftc, no Xcode project" convention as ../../voice-command/app-host/build.sh.
# No TCC/permission dialog is involved (file-based analysis only, no
# microphone/camera access), so no .app bundle/Info.plist/codesign is
# needed here, unlike the App Host.
set -euo pipefail
cd "$(dirname "$0")"
swiftc -O main.swift -o classify-tool
echo "built: $(pwd)/classify-tool"
