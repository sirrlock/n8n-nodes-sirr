# @sirrlock/n8n-nodes-sirr — Claude Development Guide

## Purpose

n8n community node for Sirr — the ephemeral secret manager. Provides a single
node with resource/operation dropdowns covering all Sirr REST API endpoints.

## Stack

- TypeScript, compiled to CommonJS (n8n requirement)
- `n8n-workflow` as peer dependency
- No runtime dependencies

## Build

```bash
npm install
npm run build    # tsc → dist/
```

## Structure

```
credentials/
  SirrApi.credentials.ts    # serverUrl + apiToken (Bearer auth)
nodes/Sirr/
  Sirr.node.ts              # Single node, resource/operation pattern
  sirr.svg                  # Logo icon
```

## API Endpoints (from Sirr server)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /secrets/:key | Bearer | Get a secret |
| POST | /secrets | Bearer | Push a secret |
| GET | /secrets | Bearer | List secrets |
| DELETE | /secrets/:key | Bearer | Delete a secret |
| POST | /prune | Bearer | Prune expired |
| GET | /audit | Bearer | Query audit log |
| POST | /webhooks | Bearer | Create webhook |
| GET | /webhooks | Bearer | List webhooks |
| DELETE | /webhooks/:id | Bearer | Delete webhook |
| GET | /me | Bearer | Get current principal |
| PATCH | /me | Bearer | Update principal metadata |
| POST | /me/keys | Bearer | Create principal API key |
| DELETE | /me/keys/:key_id | Bearer | Delete principal API key |
| GET | /health | None | Health check |

Org-scoped variants exist for secrets, prune, audit, and webhooks under `/orgs/{org_id}/...`.

## Key Rules

- Health check endpoint does NOT use auth headers
- Secret key names must be URL-encoded in path params
- `ttl_seconds` and `max_reads` use `null` (not 0) for "no limit"
- `POST /me/keys` body: `{ name, valid_for_seconds?, valid_before? }` — raw token returned once, save immediately
- `PATCH /me` body: `{ metadata: { key: value, ... } }` — arbitrary string key-value map
