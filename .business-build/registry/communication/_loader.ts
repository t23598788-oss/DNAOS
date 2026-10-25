/**
 * DNA OS Communication Registry — Loader
 * Static import approach — works in all Next.js environments (SSR, SSG, Edge)
 * All JSON files are imported at build time; no dynamic file system reads.
 */

import type { CommunicationRegistry, CommunicationManifest, ValidationResult } from "./_schema";
import { validateRegistry } from "./_validator";

import manifest from "./_index.registry.json";
import lineRaw from "./line.registry.json";
import emailRaw from "./email.registry.json";
import smsRaw from "./sms.registry.json";
import telegramRaw from "./telegram.registry.json";
import whatsappRaw from "./whatsapp.registry.json";
import voiceRaw from "./voice.registry.json";

// Cast JSON imports to CommunicationRegistry
// The JSON files conform to the schema; TypeScript can't verify JSON shapes
// without a dedicated type-guard, so we cast via unknown here.
const REGISTRY_MAP: Record<string, CommunicationRegistry> = {
  line: lineRaw as unknown as CommunicationRegistry,
  email: emailRaw as unknown as CommunicationRegistry,
  sms: smsRaw as unknown as CommunicationRegistry,
  telegram: telegramRaw as unknown as CommunicationRegistry,
  whatsapp: whatsappRaw as unknown as CommunicationRegistry,
  voice: voiceRaw as unknown as CommunicationRegistry,
};

/**
 * Load a single channel registry by name.
 * Returns null if the channel is not registered.
 */
export function load(channel: string): CommunicationRegistry | null {
  return REGISTRY_MAP[channel] ?? null;
}

/**
 * Load all channel registries.
 */
export function loadAll(): Record<string, CommunicationRegistry> {
  return { ...REGISTRY_MAP };
}

/**
 * List all registered channel names.
 */
export function listChannels(): string[] {
  return Object.keys(REGISTRY_MAP);
}

/**
 * Return the communication manifest (_index.registry.json).
 */
export function getManifest(): CommunicationManifest {
  return manifest as unknown as CommunicationManifest;
}

/**
 * Validate all loaded registries and return results.
 */
export function validateAll(): ValidationResult[] {
  return Object.entries(REGISTRY_MAP).map(([channel, registry]) =>
    validateRegistry(channel, registry)
  );
}
