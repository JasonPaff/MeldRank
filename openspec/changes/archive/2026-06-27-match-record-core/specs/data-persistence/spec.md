## REMOVED Requirements

### Requirement: Empty schema home

**Reason**: The schema home was established empty as transitional plumbing, explicitly to be filled by the Data Model work. This change introduces the first domain tables (the match-record family), so the requirement that the schema module "exports no domain tables" is now false and is superseded by the `match-record-store` capability.

**Migration**: No data migration. The `match-record-store` capability now owns the table definitions living in `packages/shared/src/server/db/schema.ts` (and its re-exported per-area modules). The Drizzle client and migration-tooling requirements in this spec are unaffected and remain in force.
