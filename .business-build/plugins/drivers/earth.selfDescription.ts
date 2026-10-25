import { createDriverRuntimeContract, createDriverContextBudget, createDriverDeltaContext, createDriverWorkOrder, createDriverExecutionReadiness, type DriverDescriptor } from "./selfDescriptionFactory";

const DESCRIPTOR: DriverDescriptor = {
  driverKey: "earth",
  targetFile: "plugins/drivers/earth.ts",
  selfDescriptionFile: "plugins/drivers/earth.selfDescription.ts",
  appLabel: "Google Earth",
  responsibilities: [
    "search(query) — calls Google Earth Pro's real native AppleScript SearchLocation command",
    "click(target) — a real no-op stub: returns ok() immediately without sending any real AppleScript command (confirmed by reading the file directly, not assumed)",
    "type(text) — sends raw keystrokes via System Events",
    "read() — returns the current window title via System Events",
  ],
};

export function getEarthDriverRuntimeContract() { return createDriverRuntimeContract(DESCRIPTOR); }
export function getEarthDriverContextBudget() { return createDriverContextBudget(DESCRIPTOR); }
export function getEarthDriverDeltaContext(previousVersionHash?: string) { return createDriverDeltaContext(DESCRIPTOR, previousVersionHash); }
export function getEarthDriverWorkOrder() { return createDriverWorkOrder(DESCRIPTOR); }
export function getEarthDriverExecutionReadiness() { return createDriverExecutionReadiness(DESCRIPTOR); }
