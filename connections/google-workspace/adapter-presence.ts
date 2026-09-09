/**
 * Truthful adapter presence for Google Workspace remote-service bindings.
 * Reflects whether the real ConnectorInvoker is registered and callable —
 * never a hard-coded boolean.
 */

import { getConnectorInvoker } from "../../control/connector-execution-boundary/registry";
import { GOOGLE_WORKSPACE_CAPABILITY_ID } from "./adapter-contract";
import { isGoogleWorkspaceAdapterInvokerCallable } from "./router-invoker";

/**
 * True only when CONNECTOR_INVOKER_REGISTRY has google-workspace and the
 * invoker function is callable. Write-class actions must still report
 * adapterPresent=false at the binding layer.
 */
export function isGoogleWorkspaceRuntimeAdapterPresent(): boolean {
  const invoker = getConnectorInvoker(GOOGLE_WORKSPACE_CAPABILITY_ID);
  if (!invoker) return false;
  if (typeof invoker !== "function") return false;
  return isGoogleWorkspaceAdapterInvokerCallable();
}
