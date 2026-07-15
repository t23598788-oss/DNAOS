import { createDriverRuntimeContract, createDriverContextBudget, createDriverDeltaContext, createDriverWorkOrder, createDriverExecutionReadiness, type DriverDescriptor } from "./selfDescriptionFactory";

const DESCRIPTOR: DriverDescriptor = {
  driverKey: "github",
  targetFile: "plugins/drivers/github.ts",
  selfDescriptionFile: "plugins/drivers/github.selfDescription.ts",
  appLabel: "GitHub Desktop",
  responsibilities: [
    "search(query) — sends Cmd+F then types the query",
    "click(target) — 'commit'/'submit' sends Cmd+Return; 'push'/'shortcut:p' sends Cmd+P; 'pull' sends Cmd+Shift+P",
    "type(text) — sends raw keystrokes via System Events",
    "read() — returns the current window title via System Events",
  ],
};

export function getGithubDriverRuntimeContract() { return createDriverRuntimeContract(DESCRIPTOR); }
export function getGithubDriverContextBudget() { return createDriverContextBudget(DESCRIPTOR); }
export function getGithubDriverDeltaContext(previousVersionHash?: string) { return createDriverDeltaContext(DESCRIPTOR, previousVersionHash); }
export function getGithubDriverWorkOrder() { return createDriverWorkOrder(DESCRIPTOR); }
export function getGithubDriverExecutionReadiness() { return createDriverExecutionReadiness(DESCRIPTOR); }
