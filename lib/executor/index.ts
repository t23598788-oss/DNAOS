export { execute } from "./executor";
export { CAPABILITIES, TOOLS, getToolsByCapability, getConnectedTools, findTool, getStatusColor, getStatusLabel } from "./capabilities";
export { executeCapability, getCapabilityInfo, listAllCapabilities, listReadCapabilities, listWriteCapabilities } from "./capability-manager";
export type { CapabilityType, Tool, ToolStatus } from "./capabilities";
export type { ExecuteRequest, ExecuteResult } from "./executor";
export type { CapabilityAction, CapabilityResult } from "./capability-manager";

// V6 Computer Control Layer
export {
  isLocalMac,
  executeAction,
  executeActions,
  executePlan,
  cancelExecution,
  getActivePlan,
  createPlan,
  sequentialStep,
  parallelStep,
  conditionalStep,
  registerApp,
  getAppController,
  listRegisteredApps,
  listAppActions,
  executeAppAction,
  listRunningApps,
  isAppRunning,
  getWindowList,
  getActiveWindow,
  getClipboard,
  setClipboard,
} from "./computer-control";
export type {
  ActionResult,
  ActionStatus,
  ComputerAction,
  DeviceAction,
  KeyboardAction,
  MouseAction,
  ScreenAction,
  ClipboardAction,
  ExecutionPlan,
  ExecutionStep,
  AppController,
  WindowInfo,
} from "./computer-control";
