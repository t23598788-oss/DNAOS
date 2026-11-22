#!/usr/bin/env python3
"""Refresh the DigitalOcean endpoint inventory from the official AI index's OpenAPI link.

This generates a documentation/registry inventory only. It never adds executable
routes or changes the gateway allow-list. New operations remain denied by default.
"""
from __future__ import annotations

import hashlib
import json
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INDEX_URL = "https://docs.digitalocean.com/llms.txt"
OPENAPI_URL = "https://docs.digitalocean.com/reference/api/reference/openapi.json"
OUTPUT = ROOT / "registry" / "digitalocean-api-provider.json"

READ_ONLY = {"GET", "HEAD"}
IMPLEMENTED_READS = {
    ("GET", "/v2/sizes"),
    ("GET", "/v2/1-clicks"),
    ("GET", "/v2/regions"),
    ("GET", "/v2/databases/options"),
    ("GET", "/v2/customers/my/balance"),
    ("GET", "/v2/customers/my/prepayment_status"),
    ("GET", "/v2/customers/my/billing_history"),
    ("GET", "/v2/customers/my/invoices"),
    ("GET", "/v2/billing/{account_urn}/insights/{start_date}/{end_date}"),
}

COMPUTE_AI_TAGS = {
    "1-Click Applications", "Action Gateway", "Action Gateway Data Plane",
    "Agent Inference", "Agent Platform API", "Apps", "Batch Inference",
    "Dedicated Inference", "Droplet Actions", "Droplet Autoscale Pools",
    "Droplets", "Embeddings", "Functions", "Harness Runtime",
    "Harness Runtime Workspaces [Public Preview]", "Kubernetes",
    "MicroVMs [Public Preview]", "Serverless Inference", "Sizes", "Regions",
}
DATABASE_STORAGE_TAGS = {
    "Block Storage", "Block Storage Actions", "Container Registries",
    "Container Registry", "Databases", "Images", "Image Actions", "NFS",
    "NFS Actions", "Snapshots", "Spaces Keys", "Vector Databases",
}
BILLING_MONITORING_TAGS = {"Billing", "Insights", "Monitoring", "Uptime"}


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "DNAOS-DigitalOcean-Registry/1.0"})
    with urllib.request.urlopen(req, timeout=45) as response:
        return response.read()


def category(tags: list[str]) -> str:
    tagset = set(tags)
    if tagset & BILLING_MONITORING_TAGS:
        return "billing_monitoring"
    if tagset & DATABASE_STORAGE_TAGS:
        return "databases_storage"
    if tagset & COMPUTE_AI_TAGS:
        return "compute_ai"
    return "other_documented_api"


def main() -> None:
    index_text = fetch(INDEX_URL).decode("utf-8")
    if OPENAPI_URL not in index_text:
        raise SystemExit("Official llms.txt no longer links to the expected OpenAPI spec; inspect before regenerating.")
    raw_spec = fetch(OPENAPI_URL)
    spec = json.loads(raw_spec)
    operations: list[dict] = []
    method_names = {"get", "head", "post", "put", "patch", "delete", "options"}
    for path, path_item in spec.get("paths", {}).items():
        for method, operation in path_item.items():
            if method.lower() not in method_names or not isinstance(operation, dict):
                continue
            verb = method.upper()
            tags = operation.get("tags", [])
            item = {
                "operation_id": operation.get("operationId"),
                "method": verb,
                "path": path,
                "summary": operation.get("summary", ""),
                "tags": tags,
                "domain_group": category(tags),
                "access_mode": "read_only" if verb in READ_ONLY else "mutating",
                "gateway_status": "source_implemented_not_production_verified" if (verb, path) in IMPLEMENTED_READS else "documented_only_default_deny",
            }
            operations.append(item)

    operations.sort(key=lambda item: (item["domain_group"], item["tags"], item["path"], item["method"]))
    by_group = Counter(item["domain_group"] for item in operations)
    by_status = Counter(item["gateway_status"] for item in operations)
    payload = {
        "schema_version": "1.0.0",
        "provider_id": "digitalocean",
        "provider_name": "DigitalOcean",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source_of_truth": {
            "ai_index_url": INDEX_URL,
            "openapi_url": OPENAPI_URL,
            "openapi_sha256": hashlib.sha256(raw_spec).hexdigest(),
            "openapi_title": spec.get("info", {}).get("title"),
            "openapi_version": spec.get("info", {}).get("version"),
            "notice": "The AI index links to this machine-readable API inventory. Endpoint descriptions are metadata, not permission to execute them.",
        },
        "request_limits": {"per_hour": 5000, "per_minute": 250, "source": "DigitalOcean public API docs; limits are per token"},
        "default_gateway_policy": "DENY_UNLESS_EXPLICITLY_IMPLEMENTED_AND_AUTHORIZED",
        "domain_groups": [
            {"id": "compute_ai", "label": "Compute & AI", "tags": sorted(COMPUTE_AI_TAGS)},
            {"id": "databases_storage", "label": "Databases & Storage", "tags": sorted(DATABASE_STORAGE_TAGS)},
            {"id": "billing_monitoring", "label": "Billing & Monitoring", "tags": sorted(BILLING_MONITORING_TAGS)},
            {"id": "other_documented_api", "label": "Other documented APIs", "note": "Included to avoid hiding DigitalOcean API areas not named in the initial three group labels."},
        ],
        "inventory_summary": {
            "documented_operations": len(operations),
            "operations_by_group": dict(sorted(by_group.items())),
            "operations_by_gateway_status": dict(sorted(by_status.items())),
            "mutation_operations_default_denied": sum(1 for item in operations if item["access_mode"] == "mutating" and item["gateway_status"] == "documented_only_default_deny"),
        },
        "separate_existing_adapters": [
            {
                "id": "digitalocean-inference-worker-adapter",
                "source_path": "app/api/admin/ide/_lib/workerAdapters/digitalOceanWorkerAdapter.ts",
                "credential_domain": "DIGITALOCEAN_INFERENCE_API_KEY or an enabled DigitalOcean inference connector",
                "note": "Separate AI Inference service and cost path; it does not pass through the DigitalOcean Control Plane metering client or customer wallet billing.",
            },
            {
                "id": "digitalocean-control-plane-meter",
                "source_path": "app/api/admin/digitalocean/_lib/meteredClient.ts",
                "credential_domain": "System Vault secret digitalocean_api_token",
                "note": "Current control-plane implementation is read-only and covers only explicitly listed catalog/billing operations; this is not an all-endpoint proxy and not a customer-charge ledger.",
            },
        ],
        "operations": operations,
    }
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(OUTPUT.relative_to(ROOT)), **payload["inventory_summary"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
