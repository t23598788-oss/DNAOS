/**
 * Ensure the workflow engine module is loaded.
 *
 * AppDriver registration used to live here too, but core must not import
 * concrete plugin drivers directly (registry/dependency-graph.json:
 * allowed_imports.core = ["registry"]) — moved to
 * plugins/registerAllDrivers.ts (Phase 2.3A), which imports this file for
 * the engine-ready side effect and then registers the drivers itself.
 */
import "@/core/executor/engine"; // ensure workflow engine module is loaded
