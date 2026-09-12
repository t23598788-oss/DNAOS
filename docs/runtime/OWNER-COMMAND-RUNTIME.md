# Owner Command runtime

**Source:** `control/owner-command/`, transport `transport/owner-command-http/`  
**Default loopback:** `127.0.0.1:8791`  
**npm script:** `npm run owner-command:serve`  
**Health script:** `npm run control-plane:health`

LaunchAgent label used on this Mac historically:
`com.dnaos.owner-command-http` (plist under `~/Library/LaunchAgents/`).

This document does **not** claim the LaunchAgent is currently loaded.
Runtime liveness must be proven separately (see evidence matrix).
