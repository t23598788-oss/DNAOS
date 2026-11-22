-- Code graph storage in the system schema of the single canonical Supabase
-- project. Each index run is an immutable source snapshot.
begin;

create table if not exists system.system_graph_index_runs (
  id uuid primary key,
  source_revision text not null,
  status text not null check (status in ('indexing', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  node_count integer not null default 0 check (node_count >= 0),
  edge_count integer not null default 0 check (edge_count >= 0),
  error_code text
);

create index if not exists system_graph_index_runs_latest_idx
  on system.system_graph_index_runs (status, finished_at desc);

create table if not exists system.system_graph_nodes (
  index_run_id uuid not null references system.system_graph_index_runs(id) on delete cascade,
  node_key text not null,
  node_type text not null check (node_type in ('File', 'Function', 'Module', 'Task')),
  name text not null,
  source_path text,
  signature text,
  metadata jsonb not null default '{}'::jsonb,
  primary key (index_run_id, node_key)
);

create index if not exists system_graph_nodes_type_idx
  on system.system_graph_nodes (index_run_id, node_type, node_key);
create index if not exists system_graph_nodes_path_idx
  on system.system_graph_nodes (index_run_id, source_path);

create table if not exists system.system_graph_edges (
  index_run_id uuid not null,
  edge_type text not null check (edge_type in ('IMPORTS', 'CALLS', 'DEPENDS_ON', 'TASK_LINKED_TO')),
  source_node_key text not null,
  target_node_key text not null,
  evidence jsonb not null default '{}'::jsonb,
  primary key (index_run_id, edge_type, source_node_key, target_node_key),
  foreign key (index_run_id, source_node_key)
    references system.system_graph_nodes(index_run_id, node_key) on delete cascade,
  foreign key (index_run_id, target_node_key)
    references system.system_graph_nodes(index_run_id, node_key) on delete cascade
);

create index if not exists system_graph_edges_source_idx
  on system.system_graph_edges (index_run_id, source_node_key, edge_type);
create index if not exists system_graph_edges_target_idx
  on system.system_graph_edges (index_run_id, target_node_key, edge_type);

alter table system.system_graph_index_runs enable row level security;
alter table system.system_graph_nodes enable row level security;
alter table system.system_graph_edges enable row level security;

revoke all on system.system_graph_index_runs from public, anon, authenticated;
revoke all on system.system_graph_nodes from public, anon, authenticated;
revoke all on system.system_graph_edges from public, anon, authenticated;
grant select, insert, update on system.system_graph_index_runs to service_role;
grant select, insert on system.system_graph_nodes to service_role;
grant select, insert on system.system_graph_edges to service_role;

commit;
