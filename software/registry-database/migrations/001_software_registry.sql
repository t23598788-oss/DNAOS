-- NON-CANONICAL HISTORICAL DRAFT. Do not execute.
-- Canonical reviewed migration: 0001_create_software_registry_schema.sql
-- This file is retained only as historical reference and intentionally does
-- not participate in the DNA OS migration path.
CREATE TABLE IF NOT EXISTS software_registry.resources (resource_id text PRIMARY KEY, fingerprint text UNIQUE NOT NULL, source_location text NOT NULL, owner text NOT NULL);
CREATE TABLE IF NOT EXISTS software_registry.capabilities (capability_id text PRIMARY KEY, fingerprint text UNIQUE NOT NULL, name text NOT NULL);
CREATE TABLE IF NOT EXISTS software_registry.resource_capabilities (resource_id text REFERENCES software_registry.resources(resource_id), capability_id text REFERENCES software_registry.capabilities(capability_id), PRIMARY KEY(resource_id,capability_id));
CREATE TABLE IF NOT EXISTS software_registry.relationships (relationship_id text PRIMARY KEY, resource_id text NOT NULL, related_id text NOT NULL, relationship_type text NOT NULL);
CREATE TABLE IF NOT EXISTS software_registry.versions (version_id text PRIMARY KEY, resource_id text NOT NULL, version text NOT NULL);
CREATE TABLE IF NOT EXISTS software_registry.evidence (evidence_id text PRIMARY KEY, registration_command_id text NOT NULL, reference text NOT NULL);
CREATE TABLE IF NOT EXISTS software_registry.registration_events (event_id text PRIMARY KEY, registration_command_id text NOT NULL, status text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now());
