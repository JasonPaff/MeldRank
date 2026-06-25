# cache-and-messaging Specification

## Purpose

Provide the foundational Upstash Redis client plumbing for server-side apps, exposing a connectivity-ready client from the server-only surface without introducing any domain messaging logic.

## Requirements

### Requirement: Upstash Redis client

The repository SHALL provide an Upstash Redis client factory, exposed from the server-only surface (`@meldrank/shared/server`) and constructed from the validated environment. The factory SHALL be importable by `apps/api` and `apps/match` and SHALL NOT be reachable from the isomorphic `@meldrank/shared` root entry.

#### Scenario: Server apps construct a working Redis client

- **WHEN** `apps/api` or `apps/match` constructs the Redis client from a valid environment
- **THEN** the client initializes and a connectivity check (e.g. `PING`) succeeds

#### Scenario: Client is absent from the client bundle

- **WHEN** `apps/web` is built
- **THEN** no Redis client is included in its bundle, because the factory is only exported from the server-only entry

### Requirement: Connectivity-only scope

The Redis foundation SHALL provide connection plumbing only. This change SHALL NOT introduce presence tracking, matchmaking queues, or API↔Match pub/sub logic; those are deferred to the changes that own those domains.

#### Scenario: No domain Redis usage is present

- **WHEN** the Redis-related code introduced by this change is inspected
- **THEN** it contains only client construction and a connectivity check, with no presence, queue, or pub/sub domain logic
