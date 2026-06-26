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
