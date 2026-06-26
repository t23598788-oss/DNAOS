/**
 * App Driver Registry
 *
 * ลงทะเบียน App Driver ใหม่ได้โดยไม่แก้ Capability Manager
 * ใช้ชื่อ app เป็น key (lowercase)
 */

import { AppDriver } from "./driver";

const drivers = new Map<string, AppDriver>();

export function registerDriver(driver: AppDriver): void {
  drivers.set(driver.appName.toLowerCase(), driver);
}

export function getDriver(appName: string): AppDriver | undefined {
  return drivers.get(appName.toLowerCase());
}

export function listDrivers(): string[] {
  return Array.from(drivers.keys());
}

export function hasDriver(appName: string): boolean {
  return drivers.has(appName.toLowerCase());
}

export function getDriverInfo(appName: string): { appName: string; bundleId: string } | null {
  const d = drivers.get(appName.toLowerCase());
  if (!d) return null;
  return { appName: d.appName, bundleId: d.bundleId };
}
