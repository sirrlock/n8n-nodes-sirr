# @sirrlock/n8n-nodes-sirr

[![npm version](https://img.shields.io/npm/v/@sirrlock/n8n-nodes-sirr)](https://www.npmjs.com/package/@sirrlock/n8n-nodes-sirr)
[![npm downloads](https://img.shields.io/npm/dm/@sirrlock/n8n-nodes-sirr)](https://www.npmjs.com/package/@sirrlock/n8n-nodes-sirr)
[![CI](https://github.com/sirrlock/n8n-nodes-sirr/actions/workflows/ci.yml/badge.svg)](https://github.com/sirrlock/n8n-nodes-sirr/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/sirrlock/n8n-nodes-sirr)](https://github.com/sirrlock/n8n-nodes-sirr)
[![Last commit](https://img.shields.io/github/last-commit/sirrlock/n8n-nodes-sirr)](https://github.com/sirrlock/n8n-nodes-sirr)

n8n community node for [Sirr](https://sirrlock.com) — the ephemeral secret manager.

## Installation

### Via n8n UI

1. Go to **Settings → Community Nodes**
2. Search for `@sirrlock/n8n-nodes-sirr`
3. Click **Install**

### Via npm

```bash
npm install @sirrlock/n8n-nodes-sirr
```

## Credentials

Create a **Sirr API** credential with:

| Field | Description | Default |
|-------|-------------|---------|
| Server URL | Base URL of your Sirr server | `http://localhost:39999` |
| API Token | Bearer token (master key or principal API key) | — |
| Organization ID | Optional org ID for multi-tenant mode (leave empty for public bucket) | — |

## Operations

| Resource | Operations |
|----------|-----------|
| Secret | Get, Check (HEAD), Push, Patch, List, Delete, Prune |
| Audit | Query |
| Webhook | Create, List, Delete |
| Principal | Get Me, Update Me, Create Key, Delete Key, Create Principal, List Principals, Delete Principal |
| Org | Create, List, Delete |
| Role | Create, List, Delete |
| Server | Health Check |

### Multi-Tenant (Org) Support

When an **Organization ID** is set in the credentials, Secret, Audit, Webhook, and Prune
operations are automatically scoped to that org (e.g. `/orgs/{orgId}/secrets/...`).
Principal self-service, Org management, Role management, and Server operations use
explicit org ID parameters and are not affected by the credential's Organization ID field.

### Secret Operations

- **Get** — fetch and consume a secret (`GET /secrets/{key}`)
- **Check** — inspect metadata via HEAD without consuming a read counter (`HEAD /secrets/{key}`)
- **Push** — store a secret with optional TTL, max reads, seal-on-expiry, and allowed-keys
- **Patch** — update an existing secret's value, TTL, or read limit (`PATCH /secrets/{key}`)
- **List** — list all active secrets
- **Delete** — permanently remove a secret
- **Prune** — delete all expired secrets

### Principal Self-Service

The **Principal** resource covers both self-service (for the caller) and admin operations (for managing others):

**Self-service** (no extra org ID needed):
- **Get Me** — retrieve your principal record, org, role, and permissions (`GET /me`)
- **Update Me** — set arbitrary key-value metadata on your principal (`PATCH /me`)
- **Create Key** — generate a named personal API key with optional time window (`POST /me/keys`)
- **Delete Key** — revoke a personal API key by ID (`DELETE /me/keys/{keyId}`)

**Admin** (requires explicit Org ID parameter):
- **Create Principal** — add a principal to an org (`POST /orgs/{orgId}/principals`)
- **List Principals** — list all principals in an org (`GET /orgs/{orgId}/principals`)
- **Delete Principal** — remove a principal from an org (`DELETE /orgs/{orgId}/principals/{id}`)

The raw key token is returned once on creation — save it immediately.

### Org Management

The **Org** resource manages multi-tenant organizations. Requires master key or SirrAdmin permission.

### Role Management

The **Role** resource manages custom roles within an org. Permissions are expressed as a letter string (e.g. `"rRlL"`): `r`=read, `R`=read-org, `w`=write, `W`=write-org, `d`=delete, `D`=delete-org, `l`=list, `L`=list-org, `p`=patch-my, `P`=patch-org, `a`=account-manage, `m`=manage-org.

## Documentation

Full guide at [sirr.dev/n8n](https://sirr.dev/n8n).

## License

MIT — see [LICENSE](LICENSE)
