import { createDriverRuntimeContract, createDriverContextBudget, createDriverDeltaContext, createDriverWorkOrder, createDriverExecutionReadiness, type DriverDescriptor } from "./selfDescriptionFactory";

const DESCRIPTOR: DriverDescriptor = {
  driverKey: "mail",
  targetFile: "plugins/drivers/mail.ts",
  selfDescriptionFile: "plugins/drivers/mail.selfDescription.ts",
  appLabel: "Mail",
  responsibilities: [
    "search(query) — sends Cmd+Option+F (Mail's real search shortcut) then types the query",
    "click(target) — 'compose' sends Cmd+N; 'subject'/'body' sends Tab (key code 48); 'shortcut:<keys>' sends Cmd+Shift+<keys>",
    "type(text) — sends raw keystrokes via System Events",
    "read() — returns the real inbox message count via AppleScript",
  ],
};

export function getMailDriverRuntimeContract() { return createDriverRuntimeContract(DESCRIPTOR); }
export function getMailDriverContextBudget() { return createDriverContextBudget(DESCRIPTOR); }
export function getMailDriverDeltaContext(previousVersionHash?: string) { return createDriverDeltaContext(DESCRIPTOR, previousVersionHash); }
export function getMailDriverWorkOrder() { return createDriverWorkOrder(DESCRIPTOR); }
export function getMailDriverExecutionReadiness() { return createDriverExecutionReadiness(DESCRIPTOR); }
