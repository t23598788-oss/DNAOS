/**
 * DNA OS Registry — Source of Truth สำหรับ Runtime
 * ทุก Module ต้อง Register ก่อนจึงจะทำงานได้
 * Runtime ห้ามค้นหาไฟล์เอง ต้อง resolve ผ่าน Registry
 */

import architecture from "./architecture.json";
import modules from "./modules.json";
import interfaces from "./interfaces.json";
import events from "./events.json";
import drivers from "./drivers.json";
import services from "./services.json";
import schemas from "./schemas.json";

// ─── Communication Registry — Generic API ────────────────────────────────────

export {
  resolveCommunication,
  resolveCapability,
  resolveLifecycle,
  resolveTopology,
  resolvePolicy,
  resolvePipeline,
  resolveHealth,
  resolveSecurityContract,
  resolveDependencies,
  isFeatureEnabled,
  isPolicyAllowed,
  getCommunicationRegistry,
  getCommunicationLifecycle,
  getCommunicationTopology,
  getCommunicationCapabilities,
  getCommunicationChannel,
} from "./communication/_resolver";

export {
  load as loadCommunicationChannel,
  loadAll as loadAllCommunicationChannels,
  listChannels as listCommunicationChannels,
  validateAll as validateAllCommunicationRegistries,
} from "./communication/_loader";

export { validateRegistry as validateCommunicationRegistry } from "./communication/_validator";

// ─── Core Architecture Registry ──────────────────────────────────────────────

export function getLayer(name: string) {
  return (architecture.layers as Record<string, unknown>)[name] ?? null;
}

export function getModule(path: string) {
  return (modules.modules as Record<string, unknown>)[path] ?? null;
}

export function getInterface(name: string) {
  return (interfaces.interfaces as Record<string, unknown>)[name] ?? null;
}

export function getEvent(name: string) {
  return (events.events as Record<string, unknown>)[name] ?? null;
}

export function getDriver(name: string) {
  return (drivers.drivers as Record<string, unknown>)[name] ?? null;
}

export function getService(name: string) {
  return (services.services as Record<string, unknown>)[name] ?? null;
}

export function getSchema(name: string) {
  return (schemas.schemas as Record<string, unknown>)[name] ?? null;
}

export function listLayers(): string[] { return Object.keys(architecture.layers); }
export function listModules(): string[] { return Object.keys(modules.modules); }
export function listInterfaces(): string[] { return Object.keys(interfaces.interfaces); }
export function listEvents(): string[] { return Object.keys(events.events); }
export function listDrivers(): string[] { return Object.keys(drivers.drivers); }
export function listServices(): string[] { return Object.keys(services.services); }
export function listSchemas(): string[] { return Object.keys(schemas.schemas); }

export function isRegistered(moduleId: string): boolean {
  return moduleId in modules.modules;
}

// ─── Backward Compatible Wrappers (LINE) ─────────────────────────────────────

import {
  resolveCommunication as _resolve,
  resolveLifecycle as _lifecycle,
  resolveTopology as _topology,
  isFeatureEnabled as _feature,
} from "./communication/_resolver";
import { getManifest } from "./communication/_loader";

export function getCommunicationIndex() { return getManifest(); }
export function getActiveChannels(): string[] { return getManifest().active_channels; }
export function getLINERegistry() { return _resolve("line"); }
export function getLINEChannel() { return _resolve("line")?.channel ?? null; }
export function getLINELifecycle() { return _lifecycle("line"); }
export function getLINETopology() { return _topology("line"); }
export function getLINEAPIs() { return (_resolve("line") as Record<string, unknown> | null)?.apis ?? null; }
export function getLINEOAFeatures() { return (_resolve("line") as Record<string, unknown> | null)?.oa_features ?? null; }
export function getLINECleanupList() { return _resolve("line")?.cleanup_required ?? null; }
export function isLINEFeatureEnabled(feature: string): boolean { return _feature("line", feature); }

// ─── Execution Registry ───────────────────────────────────────────────────────

export * from "./execution/_loader";
export * from "./execution/_resolver";
export * from "./execution/_validator";

// ─── Conversation Registry ────────────────────────────────────────────────────

export * from "./conversation/_loader";
export * from "./conversation/_resolver";
export * from "./conversation/_validator";

// ─── Trace Registry ───────────────────────────────────────────────────────────

export * from "./trace/_loader";
export * from "./trace/_resolver";
export * from "./trace/_validator";
