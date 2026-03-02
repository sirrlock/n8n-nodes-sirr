# @sirrlock/n8n-nodes-sirr

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
| API Token | Bearer token (master key or scoped API key) | — |
| Organization ID | Optional org ID for multi-tenant mode (leave empty for public bucket) | — |

## Operations

| Resource | Operations |
|----------|-----------|
| Secret | Get, Push, List, Delete, Prune |
| Audit | Query |
| Webhook | Create, List, Delete |
| API Key | Create, List, Delete |
| Principal | Get Me, Update Me, Create Key, Delete Key |
| Server | Health Check |

### Multi-Tenant (Org) Support

When an **Organization ID** is set in the credentials, Secret, Audit, Webhook, and Prune
operations are automatically scoped to that org (e.g. `/orgs/{orgId}/secrets/...`).
API Key, Principal, and Server operations are not org-scoped.

### Principal Self-Service

The **Principal** resource lets the authenticated user manage their own profile and personal API keys:

- **Get Me** — retrieve your principal record (`GET /me`)
- **Update Me** — update your display name (`PATCH /me`)
- **Create Key** — generate a personal API key (`POST /me/keys`)
- **Delete Key** — revoke a personal API key (`DELETE /me/keys/{keyId}`)

## Documentation

Full guide at [sirrlock.com/docs/n8n](https://sirrlock.com/docs/n8n).

## License

MIT
