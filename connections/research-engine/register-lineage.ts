import { registerResearchEngineLineage } from "./lineage-bridge";

registerResearchEngineLineage()
  .then((report) => {
    console.log(JSON.stringify({ status: "ok", report }, null, 2));
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
