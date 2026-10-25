import { createDriverRuntimeContract, createDriverContextBudget, createDriverDeltaContext, createDriverWorkOrder, createDriverExecutionReadiness, type DriverDescriptor } from "./selfDescriptionFactory";

const DESCRIPTOR: DriverDescriptor = {
  driverKey: "maps",
  targetFile: "plugins/drivers/maps.ts",
  selfDescriptionFile: "plugins/drivers/maps.selfDescription.ts",
  appLabel: "Google Maps",
  responsibilities: [
    "search(query) — opens a real Google Maps search URL via the shared openUrl helper (real bundleId is Google Chrome, since Maps runs inside it)",
    "click(target) — 'url:<url>' opens that URL directly",
    "type(text) — sends raw keystrokes via System Events",
    "read() — returns the active Chrome tab's URL (real cross-driver dependency: reads via 'tell application \"Google Chrome\"', not a Maps-specific API)",
  ],
};

export function getMapsDriverRuntimeContract() { return createDriverRuntimeContract(DESCRIPTOR); }
export function getMapsDriverContextBudget() { return createDriverContextBudget(DESCRIPTOR); }
export function getMapsDriverDeltaContext(previousVersionHash?: string) { return createDriverDeltaContext(DESCRIPTOR, previousVersionHash); }
export function getMapsDriverWorkOrder() { return createDriverWorkOrder(DESCRIPTOR); }
export function getMapsDriverExecutionReadiness() { return createDriverExecutionReadiness(DESCRIPTOR); }
