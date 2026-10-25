/**
 * Storage Intelligence — Docker adapter. Read-only inspection only, ever.
 * Docker Desktop stores images/volumes/build-cache inside its own VM disk
 * image, not as regular host files — this adapter can never move Docker
 * resources to Trash, only report what a manual `docker ... prune` would
 * reclaim. engines/storage/engine.ts's inspectDocker() is the only caller.
 */
import { execSync } from "child_process";

function sh(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

export interface DockerResourceReport {
  daemon_running: boolean;
  images_reclaimable_bytes: number | null;
  containers_reclaimable_bytes: number | null;
  volumes_reclaimable_bytes: number | null;
  build_cache_reclaimable_bytes: number | null;
  dangling_image_ids: string[];
  unused_volume_names: string[];
  note: string;
}

function parseSizeToBytes(s: string): number {
  const m = s.trim().match(/^([\d.]+)\s*([KMGT]?B)$/i);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const mult: Record<string, number> = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };
  return Math.round(val * (mult[unit] ?? 1));
}

export function inspectDocker(): DockerResourceReport {
  const daemonUp = !!sh("docker info 2>/dev/null");
  if (!daemonUp) {
    return {
      daemon_running: false,
      images_reclaimable_bytes: null,
      containers_reclaimable_bytes: null,
      volumes_reclaimable_bytes: null,
      build_cache_reclaimable_bytes: null,
      dangling_image_ids: [],
      unused_volume_names: [],
      note: "Docker daemon not running — cannot inspect. Storage lives in Docker Desktop's VM disk image, never Trash-movable; run `docker system prune -a --volumes` manually or use Docker Desktop's own cleanup UI.",
    };
  }
  const df = sh("docker system df --format '{{.Type}},{{.Reclaimable}}'");
  const rows = df.split("\n").filter(Boolean).map((l) => l.split(","));
  const get = (type: string) => {
    const row = rows.find((r) => r[0] === type);
    if (!row || !row[1]) return null;
    return parseSizeToBytes(row[1].split(" ")[0]);
  };
  const dangling = sh("docker images -f dangling=true -q").split("\n").filter(Boolean);
  const unusedVolumes = sh("docker volume ls -f dangling=true --format '{{.Name}}'").split("\n").filter(Boolean);
  return {
    daemon_running: true,
    images_reclaimable_bytes: get("Images"),
    containers_reclaimable_bytes: get("Containers"),
    volumes_reclaimable_bytes: get("Local Volumes"),
    build_cache_reclaimable_bytes: get("Build Cache"),
    dangling_image_ids: dangling,
    unused_volume_names: unusedVolumes,
    note: "Reclaim plan only — this adapter never runs `docker prune`. Owner must run it manually after reviewing the plan.",
  };
}
