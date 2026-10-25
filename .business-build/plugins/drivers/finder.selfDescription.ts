import { createDriverRuntimeContract, createDriverContextBudget, createDriverDeltaContext, createDriverWorkOrder, createDriverExecutionReadiness, type DriverDescriptor } from "./selfDescriptionFactory";

const DESCRIPTOR: DriverDescriptor = {
  driverKey: "finder",
  targetFile: "plugins/drivers/finder.ts",
  selfDescriptionFile: "plugins/drivers/finder.selfDescription.ts",
  appLabel: "Finder",
  responsibilities: [
    "search(query) — opens a POSIX file path directly via AppleScript",
    "click(target) — 'new_folder' sends Cmd+Shift+N",
    "type(text) — sends raw keystrokes via System Events",
    "read() — returns the currently selected file(s) as POSIX paths",
    "close() — REAL OVERRIDE, not inherited: closes every Finder window directly, unlike other drivers which rely on BaseDriver's default close()",
  ],
};

export function getFinderDriverRuntimeContract() { return createDriverRuntimeContract(DESCRIPTOR); }
export function getFinderDriverContextBudget() { return createDriverContextBudget(DESCRIPTOR); }
export function getFinderDriverDeltaContext(previousVersionHash?: string) { return createDriverDeltaContext(DESCRIPTOR, previousVersionHash); }
export function getFinderDriverWorkOrder() { return createDriverWorkOrder(DESCRIPTOR); }
export function getFinderDriverExecutionReadiness() { return createDriverExecutionReadiness(DESCRIPTOR); }
