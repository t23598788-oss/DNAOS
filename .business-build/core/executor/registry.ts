/**
 * Driver Registry — เพิ่มแอปใหม่ไม่ต้องแก้ Engine
 */
import type { AppDriver } from "@/core/shared/types";

const drivers = new Map<string, AppDriver>();

export function register(driver: AppDriver) { drivers.set(driver.appName.toLowerCase(), driver); }
export function get(name: string): AppDriver | undefined { return drivers.get(name.toLowerCase()); }
export function list(): string[] { return Array.from(drivers.keys()); }
export function has(name: string): boolean { return drivers.has(name.toLowerCase()); }
