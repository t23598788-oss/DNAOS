/**
 * Public boundary of control/local-tool-fabric/.
 */

export {
  LOCAL_TOOL_ADAPTER_FABRIC_SCHEMA,
  LOCAL_APP_CAPABILITY_REGISTRY_SCHEMA,
  DEVICE_RESOURCE_SCHEMA,
  NATIVE_INTERFACE_FIRST_SCHEMA,
  LOCAL_TOOL_CHAIN_SCHEMA,
  TOOL_CAPABILITY_HEALTH_SCHEMA,
  NATIVE_INTERFACE_ORDER,
  ADAPTER_PREFERENCE,
} from "./types";
export type {
  AdapterType,
  AdapterLifecycle,
  DeviceType,
  LocalToolAdapterV1,
  DeviceResourceV1,
  LocalAppCapabilityRegistryV1,
  ToolCapabilityHealthV1,
} from "./types";

export { refreshLocalToolFabric, listLocalTools, getLocalTool, listLocalAppCapabilityRegistry, listToolCapabilities } from "./adapters";
export { discoverDevices, listDevices, getDevice } from "./devices";
export { resolveLocalToolRoute, invokeAccessibilityFallback } from "./native-first";
export { executeLocalToolAction } from "./execute";
export { runLocalToolChain } from "./chain";
export { getToolHealth, listToolHealth } from "./health";


