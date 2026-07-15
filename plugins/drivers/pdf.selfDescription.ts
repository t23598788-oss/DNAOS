import { createDriverRuntimeContract, createDriverContextBudget, createDriverDeltaContext, createDriverWorkOrder, createDriverExecutionReadiness, type DriverDescriptor } from "./selfDescriptionFactory";

const DESCRIPTOR: DriverDescriptor = {
  driverKey: "pdf",
  targetFile: "plugins/drivers/pdf.ts",
  selfDescriptionFile: "plugins/drivers/pdf.selfDescription.ts",
  appLabel: "PDF Viewer",
  responsibilities: [
    "search(query) — if query looks like a path, opens it directly via Preview (real bundleId com.apple.Preview); otherwise sends Cmd+F and types the query",
    "click(target) — 'print' sends Cmd+P; 'export' sends Cmd+E",
    "type(text) — sends raw keystrokes via System Events",
    "read() — returns the current window title via System Events",
  ],
};

export function getPdfDriverRuntimeContract() { return createDriverRuntimeContract(DESCRIPTOR); }
export function getPdfDriverContextBudget() { return createDriverContextBudget(DESCRIPTOR); }
export function getPdfDriverDeltaContext(previousVersionHash?: string) { return createDriverDeltaContext(DESCRIPTOR, previousVersionHash); }
export function getPdfDriverWorkOrder() { return createDriverWorkOrder(DESCRIPTOR); }
export function getPdfDriverExecutionReadiness() { return createDriverExecutionReadiness(DESCRIPTOR); }
