# Workspace: manual arrangement and real tool bindings

The owner arranges the UI. This layer does not provision services, change schemas,
grant access, or start agents by moving a box.

ONE NAVIGATION (2026-10-06): the screen itself is `WorkspaceFrame.tsx` only —
the old `BusinessWorkspace.tsx` shell (IconRail + TabStrip), `WorkspaceSettings.tsx`,
`InboxIndicator.tsx`, and `_lib/workspaceAppearance.ts` were deleted. The menu is
the frame's edge buttons; there is no in-page tab bar or rail.

## Where to change each part

- `_lib/businessTools.ts`: icon and label for each stable tool key. Its sample
  models remain reference material; the production workspace no longer uses them.
- `_lib/toolBindings.ts`: existing-screen routes, live target IDs, and explicit
  reasons when a tool is not connected. Presentation metadata only, not a second
  capability/permission registry. Never put credentials or user-supplied URLs here.
  (Read by auth-access-test + provider-credentials-test; no runtime renderer.)

## Actual call path

`page.tsx` resolves the session and uses the existing central capability resolver.
Only granted people/jobs tools invoke their existing server loaders. Those loaders
produce `liveModels` and `liveTargets`; the client uses the existing display renderer.
Selecting a row opens its supplied target, never a fabricated record.

Other connected entries currently launch the **existing guarded screen**, not a
new API or an embedded service. The binding label does not claim live provider
health. Search, changes, validation, history, and accounting explicitly wait for
a real binding. Unified inbox, file conversion, sharing, and AI execution are not
implemented by this foundation. No automatic Cline/Freebuff launch is introduced.

## Adding a capability safely

1. Reuse its existing server/API authority and operation. A tool-order entry or
   icon is never authorization; the central permissions registry remains in charge.
2. Add presentation binding metadata using the stable tool key. For an existing
   screen, provide its verified route. For inline data, load on the server only
   after the capability is granted, then supply its display model and targets.
3. Use an explicit unavailable/error state if data cannot be loaded. Never replace
   missing real results with demo results. Mutating actions must retain the existing
   server's validation/confirmation and return real results/evidence.
4. Place the box/icon by changing presentation configuration. Test with both an
   allowed and a denied account. Do not add a second writer or permissions store.

## Verification

`node --import tsx scripts/workspace-tool-bindings-test.tsx`

`node --import tsx scripts/workspace-capability-access-test.ts`

These checks do not require credentials. End-to-end provider operations still
require a real authorized session; they are not claimed by the local checks.
