import { createDriverRuntimeContract, createDriverContextBudget, createDriverDeltaContext, createDriverWorkOrder, createDriverExecutionReadiness, type DriverDescriptor } from "./selfDescriptionFactory";

const DESCRIPTOR: DriverDescriptor = {
  driverKey: "calendar",
  targetFile: "plugins/drivers/calendar.ts",
  selfDescriptionFile: "plugins/drivers/calendar.selfDescription.ts",
  appLabel: "Calendar",
  responsibilities: [
    "search(query) — sends Cmd+F then types the query",
    "click(target) — 'new_event' sends Cmd+N; 'submit' sends the Return key",
    "type(text) — sends raw keystrokes via System Events",
    "read() — returns the current window title via System Events",
  ],
};

export function getCalendarDriverRuntimeContract() { return createDriverRuntimeContract(DESCRIPTOR); }
export function getCalendarDriverContextBudget() { return createDriverContextBudget(DESCRIPTOR); }
export function getCalendarDriverDeltaContext(previousVersionHash?: string) { return createDriverDeltaContext(DESCRIPTOR, previousVersionHash); }
export function getCalendarDriverWorkOrder() { return createDriverWorkOrder(DESCRIPTOR); }
export function getCalendarDriverExecutionReadiness() { return createDriverExecutionReadiness(DESCRIPTOR); }
