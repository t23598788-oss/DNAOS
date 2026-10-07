/**
 * DEVICE_RESOURCE_V1 — discovery only. No mutation. No sudo.
 */

import { existsSync } from "node:fs";
import { emitLocalResourceEvent } from "../local-resource-access/contract";
import { listPersistedDevices, persistDevices } from "./persist";
import type { DeviceResourceV1 } from "./types";

function device(partial: Omit<DeviceResourceV1, "schema" | "locality" | "authority_required" | "evidence_policy" | "grants_authority" | "owner_enabled">): DeviceResourceV1 {
  return {
    schema: "DEVICE_RESOURCE_V1",
    locality: "THIS_MACHINE",
    authority_required: "OWNER_GRANT",
    evidence_policy: "LOCAL_EXECUTION_ENVELOPE",
    grants_authority: false,
    owner_enabled: false,
    ...partial,
  };
}

export function discoverDevices(work_id: string, session_id: string): readonly DeviceResourceV1[] {
  const rows: DeviceResourceV1[] = [
    device({
      device_id: "device://storage/this-machine",
      device_type: "STORAGE_DEVICE",
      hardware_identity_non_secret: "macos-disk-summary",
      connection_type: "INTERNAL",
      availability: "AVAILABLE",
      capabilities: ["READ"],
      input_classes: [],
      output_classes: ["STATUS"],
      resource_id: "resource://local/os/disk",
    }),
    device({
      device_id: "device://network/this-machine",
      device_type: "NETWORK_INTERFACE",
      hardware_identity_non_secret: "os.networkInterfaces",
      connection_type: "INTERNAL",
      availability: "AVAILABLE",
      capabilities: ["READ"],
      input_classes: [],
      output_classes: ["STATUS"],
      resource_id: "resource://local/os/network",
    }),
    device({
      device_id: "device://display/this-machine",
      device_type: "DISPLAY",
      hardware_identity_non_secret: "windowserver-present",
      connection_type: "INTERNAL",
      availability: existsSync("/System/Library/CoreServices/WindowServer.app") || existsSync("/System/Library/PrivateFrameworks/SkyLight.framework") ? "DISCOVERED" : "UNAVAILABLE",
      capabilities: ["READ"],
      input_classes: [],
      output_classes: ["STATUS"],
      resource_id: null,
    }),
    device({
      device_id: "device://printer/this-machine",
      device_type: "PRINTER",
      hardware_identity_non_secret: "cups-control-present",
      connection_type: "LOCAL_SERVICE",
      availability: existsSync("/private/etc/cups") || existsSync("/Library/Printers") ? "DISCOVERED" : "UNAVAILABLE",
      capabilities: ["READ"],
      input_classes: ["DOCUMENT_HANDLE"],
      output_classes: ["PRINT_JOB_RESULT"],
      resource_id: null,
    }),
    device({
      device_id: "device://audio-out/this-machine",
      device_type: "AUDIO_OUTPUT",
      hardware_identity_non_secret: "coreaudio-present",
      connection_type: "INTERNAL",
      availability: existsSync("/System/Library/Frameworks/CoreAudio.framework") ? "DISCOVERED" : "UNAVAILABLE",
      capabilities: ["READ"],
      input_classes: [],
      output_classes: ["STATUS"],
      resource_id: null,
    }),
    device({
      device_id: "device://audio-in/this-machine",
      device_type: "AUDIO_INPUT",
      hardware_identity_non_secret: "coreaudio-input",
      connection_type: "INTERNAL",
      availability: existsSync("/System/Library/Frameworks/CoreAudio.framework") ? "DISCOVERED" : "UNAVAILABLE",
      capabilities: ["READ"],
      input_classes: [],
      output_classes: ["STATUS"],
      resource_id: null,
    }),
    device({
      device_id: "device://camera/this-machine",
      device_type: "CAMERA",
      hardware_identity_non_secret: "avfoundation-present",
      connection_type: "INTERNAL",
      availability: existsSync("/System/Library/Frameworks/AVFoundation.framework") ? "DISCOVERED" : "UNAVAILABLE",
      capabilities: ["READ"],
      input_classes: [],
      output_classes: ["STATUS"],
      resource_id: null,
    }),
    device({
      device_id: "device://scanner/this-machine",
      device_type: "SCANNER",
      hardware_identity_non_secret: "image-capture-present",
      connection_type: "INTERNAL",
      availability: existsSync("/System/Library/Frameworks/ImageCaptureCore.framework") ? "DISCOVERED" : "UNAVAILABLE",
      capabilities: ["READ"],
      input_classes: [],
      output_classes: ["STATUS"],
      resource_id: null,
    }),
  ];
  persistDevices(rows);
  for (const row of rows) {
    emitLocalResourceEvent("DEVICE_DISCOVERED", work_id, row.device_id, undefined, {
      session_id, resource_id: row.resource_id ?? undefined, authority_decision: "DENY", locality: "LOCAL",
    });
    if (row.resource_id && row.availability === "AVAILABLE") {
      emitLocalResourceEvent("DEVICE_CAPABILITY_VERIFIED", work_id, "READ", undefined, {
        session_id, resource_id: row.resource_id, locality: "LOCAL",
      });
    }
  }
  return rows;
}

export function listDevices(): readonly DeviceResourceV1[] {
  const rows = listPersistedDevices();
  return rows.length > 0 ? rows : discoverDevices("work-device-lazy", "session-device-lazy");
}

export function getDevice(device_id: string): DeviceResourceV1 | null {
  return listDevices().find((row) => row.device_id === device_id) ?? null;
}
