import { existsSync, accessSync, constants } from "node:fs";
import { join } from "node:path";
import { emitLocalResourceEvent } from "../local-resource-access/contract";
import { repoRoot, process } from "./host-runtime";
import type { MacosPermissionStateV1, PermissionTruth } from "./types";

function state(permission: string, api_exists: boolean, truth: PermissionTruth): MacosPermissionStateV1 {
  return {
    schema: "MACOS_PERMISSION_STATE_V1",
    permission,
    state: truth,
    api_exists,
    dna_os_has_permission: truth === "GRANTED",
    auto_requested: false,
  };
}

export function getMacosPermissionState(): readonly MacosPermissionStateV1[] {
  const corpus = join(repoRoot(), "control/local-resource-access/fixtures/corpus/notes.txt");
  let files: PermissionTruth = "NOT_REQUESTED";
  try {
    if (existsSync(corpus)) {
      accessSync(corpus, constants.R_OK);
      files = "GRANTED";
    }
  } catch {
    files = "DENIED";
  }
  const tccDb = `${process.env.HOME ?? ""}/Library/Application Support/com.apple.TCC/TCC.db`;
  const tccReadable = Boolean(process.env.HOME) && existsSync(tccDb);
  let fda: PermissionTruth = "NOT_REQUESTED";
  if (tccReadable) {
    try {
      accessSync(tccDb, constants.R_OK);
      fda = "GRANTED";
    } catch {
      fda = "DENIED";
    }
  } else {
    fda = "NOT_AVAILABLE";
  }
  const axApi = existsSync("/System/Library/Frameworks/ApplicationServices.framework");
  const rows = [
    state("Accessibility", axApi, "NOT_REQUESTED"),
    state("Automation", existsSync("/System/Library/Frameworks/ScriptingBridge.framework"), "NOT_REQUESTED"),
    state("Files/Folders", true, files),
    state("Full Disk Access", true, fda === "GRANTED" ? "GRANTED" : fda),
    state("Camera", existsSync("/System/Library/Frameworks/AVFoundation.framework"), "NOT_REQUESTED"),
    state("Microphone", existsSync("/System/Library/Frameworks/AVFoundation.framework"), "NOT_REQUESTED"),
    state("Screen Recording", existsSync("/System/Library/Frameworks/ScreenCaptureKit.framework") || axApi, "NOT_REQUESTED"),
    state("Endpoint Security entitlement", existsSync("/System/Library/Frameworks/EndpointSecurity.framework"), "NOT_AVAILABLE"),
  ];
  emitLocalResourceEvent("MACOS_PERMISSION_OBSERVED", null, "TCC_TRUTH", undefined, { locality: "LOCAL" });
  return rows;
}
