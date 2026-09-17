# DNA OS — SOURCE INVENTORY

Canonical source inventory for current main.

## SOURCE
- Tracked files: 1625
- UI routes: 96
- API routes: 298
- Edge Functions: 25
- Supabase migrations: 112
- Runtime modules: 539
- Connected source: 622

## CONNECTIONS
- SUPABASE: 370 paths
- LINE: 58 paths
- VERCEL: 67 paths
- RAILWAY: 0 detected paths

## INVENTORY FILES
01-tracked-files.txt       = SOURCE
02-routes.txt              = ROUTES
03-edge-functions.txt      = EDGE_FUNCTIONS
04-migrations.txt          = DATABASE_SCHEMA_HISTORY
05-runtime-modules.txt     = RUNTIME
06-provider-paths.txt      = PROVIDER_REFERENCES
07-route-groups.txt        = UI_API_ROUTE_MAP
08-provider-groups.txt     = CONNECTION_PROVIDER_MAP
09-connected-source.txt    = CONNECTED_SOURCE_MAP

## CLASSIFICATION
UI          = app routes rendered to users
API         = app/api routes
DATABASE    = Supabase schema/migrations
LINE        = LINE webhook/function paths
RUNTIME     = engines/services/API runtime
DEPLOYMENT  = provider/deployment paths
LEGACY      = old provider/path only after separately verified
