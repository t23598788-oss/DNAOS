// Ollama Cloud Gateway — the single real entry point every local script uses
// to reach Ollama, since Migration Completion (owner, 2026-08-04: "เปลี่ยนทุก
// Script, LaunchAgent และ Service ที่ยังเรียก localhost:11434 ให้เรียก Cloud
// Runtime ผ่าน Gateway ของ DNA OS...เมื่อไม่มี Dependency เหลือ จึงย้าย
// ~/.ollama เข้า Trash"). No local fallback — if the Cloud Runtime isn't
// ready, callers get null and must handle "retry later" themselves (never
// silently point at a Mac that no longer has any models installed).
import { ensurePodRunning, waitForOllamaReady } from "./runpod-controller.mjs";

export async function getReadyOllamaUrl(logPrefix = "[ollama-cloud-gateway]") {
  try {
    const ensured = await ensurePodRunning();
    if (!ensured.ok || !ensured.pod?.id) {
      console.error(`${logPrefix} ensurePodRunning ล้มเหลว: ${JSON.stringify(ensured.errors ?? ensured)}`);
      return null;
    }
    const readiness = await waitForOllamaReady(ensured.pod.id);
    if (!readiness.ready) {
      console.error(`${logPrefix} Cloud Runtime ยังไม่พร้อม: ${readiness.error}`);
      return null;
    }
    return readiness.url;
  } catch (e) {
    console.error(`${logPrefix} error: ${e.message}`);
    return null;
  }
}
