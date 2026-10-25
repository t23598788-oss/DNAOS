import { createDriverRuntimeContract, createDriverContextBudget, createDriverDeltaContext, createDriverWorkOrder, createDriverExecutionReadiness, type DriverDescriptor } from "./selfDescriptionFactory";

const DESCRIPTOR: DriverDescriptor = {
  driverKey: "vscode",
  targetFile: "plugins/drivers/vscode.ts",
  selfDescriptionFile: "plugins/drivers/vscode.selfDescription.ts",
  appLabel: "VS Code",
  responsibilities: [
    "search(query) — if query looks like a path, opens it via the real `code` CLI shell command; otherwise opens Cmd+P (Quick Open) and types the query",
    "click(target) — 'terminal' toggles the integrated terminal (Ctrl+`); 'shortcut:<keys>' sends a Cmd+<keys> shortcut",
    "type(text) — sends raw keystrokes via System Events",
    "read() — returns the current window title via System Events",
  ],
};

export function getVscodeDriverRuntimeContract() { return createDriverRuntimeContract(DESCRIPTOR); }
export function getVscodeDriverContextBudget() { return createDriverContextBudget(DESCRIPTOR); }
export function getVscodeDriverDeltaContext(previousVersionHash?: string) { return createDriverDeltaContext(DESCRIPTOR, previousVersionHash); }
export function getVscodeDriverWorkOrder() { return createDriverWorkOrder(DESCRIPTOR); }
export function getVscodeDriverExecutionReadiness() { return createDriverExecutionReadiness(DESCRIPTOR); }
