import { createDriverRuntimeContract, createDriverContextBudget, createDriverDeltaContext, createDriverWorkOrder, createDriverExecutionReadiness, type DriverDescriptor } from "./selfDescriptionFactory";

const DESCRIPTOR: DriverDescriptor = {
  driverKey: "terminal",
  targetFile: "plugins/drivers/terminal.ts",
  selfDescriptionFile: "plugins/drivers/terminal.selfDescription.ts",
  appLabel: "Terminal",
  responsibilities: [
    "search(query) — runs a real `find . -name <query>` shell command in Terminal",
    "click(target) — 'submit' sends the Return key",
    "type(text) — runs the text as a real shell command in the selected tab",
    "read() — returns the last 500 characters of the selected tab's real content",
  ],
};

export function getTerminalDriverRuntimeContract() { return createDriverRuntimeContract(DESCRIPTOR); }
export function getTerminalDriverContextBudget() { return createDriverContextBudget(DESCRIPTOR); }
export function getTerminalDriverDeltaContext(previousVersionHash?: string) { return createDriverDeltaContext(DESCRIPTOR, previousVersionHash); }
export function getTerminalDriverWorkOrder() { return createDriverWorkOrder(DESCRIPTOR); }
export function getTerminalDriverExecutionReadiness() { return createDriverExecutionReadiness(DESCRIPTOR); }
