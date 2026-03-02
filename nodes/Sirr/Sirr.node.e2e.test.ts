/**
 * E2E tests — run against a live sirrd instance.
 *
 * Prerequisites:
 *   sirrd --data-dir /tmp/sirr-e2e &
 *   export SIRR_EXTERNAL=1
 *   export SIRR_SERVER="http://127.0.0.1:39999"   # default
 *   export SIRR_API_KEY="<master-key>"
 *
 *   npm run test:e2e
 *
 * Tests clean up after themselves via afterAll/afterEach.
 * Rate limit: sirrd defaults to 10 req/s burst 30 — run as one invocation.
 */

import type { IExecuteFunctions } from 'n8n-workflow';
import { Sirr } from './Sirr.node';

const EXTERNAL = process.env.SIRR_EXTERNAL === '1';
const SERVER = (process.env.SIRR_SERVER ?? 'http://127.0.0.1:39999').replace(/\/$/, '');
const API_KEY = process.env.SIRR_API_KEY ?? '';

// Skip the entire suite when SIRR_EXTERNAL is not set
const describeE2E = EXTERNAL ? describe : describe.skip;

// ── Real HTTP context ─────────────────────────────────────────────────────────

function makeRealCtx(params: Record<string, unknown>, org = '') {
  return {
    getInputData: () => [{ json: {} }],
    getCredentials: () => Promise.resolve({ serverUrl: SERVER, apiToken: API_KEY, org }),
    getNodeParameter: (name: string, _i: number, fallback?: unknown) =>
      name in params ? params[name] : (fallback ?? ''),
    helpers: {
      httpRequestWithAuthentication: async (_cred: string, opts: Record<string, unknown>) => {
        const url = opts.url as string;
        const method = (opts.method as string) ?? 'GET';
        const qs = opts.qs as Record<string, string | number> | undefined;
        const body = opts.body;
        const returnFullResponse = opts.returnFullResponse as boolean | undefined;

        const finalUrl = qs && Object.keys(qs).length
          ? `${url}?${new URLSearchParams(Object.entries(qs).map(([k, v]) => [k, String(v)])).toString()}`
          : url;

        const res = await fetch(finalUrl, {
          method,
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: body != null ? JSON.stringify(body) : undefined,
        });

        if (!res.ok) {
          const text = await res.text();
          const err = Object.assign(new Error(text || `HTTP ${res.status}`), {
            response: { statusCode: res.status, body: text },
          });
          throw err;
        }

        if (returnFullResponse) {
          const headers: Record<string, string> = {};
          res.headers.forEach((value, key) => { headers[key] = value; });
          const text = await res.text();
          return { headers, statusCode: res.status, body: text || null };
        }

        const text = await res.text();
        return text ? JSON.parse(text) : null;
      },
      httpRequest: async (opts: Record<string, unknown>) => {
        const res = await fetch(opts.url as string, { method: (opts.method as string) ?? 'GET' });
        const text = await res.text();
        return text ? JSON.parse(text) : null;
      },
    },
    continueOnFail: () => false,
    getNode: () => ({ name: 'Sirr', type: 'sirr', typeVersion: 1, position: [0, 0] as [number, number], id: '1', parameters: {} }),
  };
}

async function nodeRun(params: Record<string, unknown>, org = '') {
  const node = new Sirr();
  const ctx = makeRealCtx(params, org);
  const result = await node.execute.call(ctx as unknown as IExecuteFunctions);
  return result[0];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function deleteSecret(key: string) {
  await fetch(`${SERVER}/secrets/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${API_KEY}` },
  }).catch(() => {/* best-effort cleanup */});
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describeE2E('E2E — Server', () => {
  it('health check returns ok', async () => {
    const [item] = await nodeRun({ resource: 'server', operation: 'healthCheck' });
    expect((item.json as Record<string, unknown>).status).toBe('ok');
  });
});

describeE2E('E2E — Secret round-trip', () => {
  const key = `e2e-roundtrip-${Date.now()}`;

  afterAll(() => deleteSecret(key));

  it('push → get → delete', async () => {
    // push
    const [pushed] = await nodeRun({
      resource: 'secret', operation: 'push',
      pushKey: key, value: 'round-trip-value',
      ttlSeconds: 300, maxReads: 0, sealOnExpiry: false, allowedKeys: '',
    });
    expect((pushed.json as Record<string, unknown>).key).toBe(key);

    // get
    const [got] = await nodeRun({ resource: 'secret', operation: 'get', key });
    expect((got.json as Record<string, unknown>).value).toBe('round-trip-value');

    // delete
    const [deleted] = await nodeRun({ resource: 'secret', operation: 'delete', key });
    expect((deleted.json as Record<string, unknown>).deleted).toBe(true);
  });

  it('list includes pushed keys', async () => {
    const listKey = `e2e-list-${Date.now()}`;
    await nodeRun({
      resource: 'secret', operation: 'push',
      pushKey: listKey, value: 'list-me', ttlSeconds: 60, maxReads: 0, sealOnExpiry: false, allowedKeys: '',
    });
    try {
      const [result] = await nodeRun({ resource: 'secret', operation: 'list' });
      const secrets = (result.json as Record<string, unknown>).secrets as Array<{ key: string }>;
      expect(secrets.some(s => s.key === listKey)).toBe(true);
    } finally {
      await deleteSecret(listKey);
    }
  });
});

describeE2E('E2E — Check (HEAD)', () => {
  const key = `e2e-check-${Date.now()}`;

  afterAll(() => deleteSecret(key));

  it('check returns metadata without consuming a read', async () => {
    // push with max_reads=2
    await nodeRun({
      resource: 'secret', operation: 'push',
      pushKey: key, value: 'check-me', ttlSeconds: 300, maxReads: 2, sealOnExpiry: false, allowedKeys: '',
    });

    // check — should not increment read count
    const [checked] = await nodeRun({ resource: 'secret', operation: 'check', key });
    const meta = checked.json as Record<string, unknown>;
    expect(meta.status).toBe('active');
    expect(meta.read_count).toBe(0);
    expect(meta.reads_remaining).toBe('2');

    // get — consumes one read
    await nodeRun({ resource: 'secret', operation: 'get', key });

    // check again — read count should now be 1
    const [checked2] = await nodeRun({ resource: 'secret', operation: 'check', key });
    const meta2 = checked2.json as Record<string, unknown>;
    expect(meta2.read_count).toBe(1);
    expect(meta2.reads_remaining).toBe('1');
  });
});

describeE2E('E2E — Seal on Expiry + Patch', () => {
  const key = `e2e-seal-${Date.now()}`;

  afterAll(() => deleteSecret(key));

  it('push with sealOnExpiry, read until sealed, then patch to extend TTL', async () => {
    // push with max_reads=1 and seal-on-expiry
    await nodeRun({
      resource: 'secret', operation: 'push',
      pushKey: key, value: 'seal-me', ttlSeconds: 300, maxReads: 1, sealOnExpiry: true, allowedKeys: '',
    });

    // consume the one read — secret becomes sealed
    const [got] = await nodeRun({ resource: 'secret', operation: 'get', key });
    expect((got.json as Record<string, unknown>).value).toBe('seal-me');

    // second read — secret is sealed, should throw (410)
    await expect(
      nodeRun({ resource: 'secret', operation: 'get', key }),
    ).rejects.toBeDefined();

    // patch to extend TTL and reset reads — unseals it
    const [patched] = await nodeRun({
      resource: 'secret', operation: 'patch',
      key, patchValue: '', patchTtlSeconds: 600, patchMaxReads: 5,
    });
    expect(patched.json).toBeDefined();
  });
});

describeE2E('E2E — Burn-after-read', () => {
  const key = `e2e-burn-${Date.now()}`;

  afterAll(() => deleteSecret(key));

  it('second read returns error after max_reads=1', async () => {
    await nodeRun({
      resource: 'secret', operation: 'push',
      pushKey: key, value: 'burn-me', ttlSeconds: 0, maxReads: 1, sealOnExpiry: false, allowedKeys: '',
    });

    // first read — succeeds
    const [first] = await nodeRun({ resource: 'secret', operation: 'get', key });
    expect((first.json as Record<string, unknown>).value).toBe('burn-me');

    // second read — secret is burned, should throw
    await expect(
      nodeRun({ resource: 'secret', operation: 'get', key }),
    ).rejects.toBeDefined();
  });
});

describeE2E('E2E — Prune', () => {
  it('prune returns pruned count', async () => {
    const [result] = await nodeRun({ resource: 'secret', operation: 'prune' });
    expect(typeof (result.json as Record<string, unknown>).pruned).toBe('number');
  });
});

describeE2E('E2E — Audit', () => {
  it('query returns events array', async () => {
    const [result] = await nodeRun({
      resource: 'audit', operation: 'query',
      since: 0, until: 0, actionFilter: '', limit: 10,
    });
    expect(Array.isArray((result.json as Record<string, unknown>).events)).toBe(true);
  });
});

describeE2E('E2E — Principal key lifecycle', () => {
  let keyId: string;

  afterAll(async () => {
    if (keyId) {
      await nodeRun({ resource: 'principal', operation: 'deleteKey', principalKeyId: keyId })
        .catch(() => {/* already deleted */});
    }
  });

  it('get me returns principal info', async () => {
    const [result] = await nodeRun({ resource: 'principal', operation: 'me' });
    const me = result.json as Record<string, unknown>;
    expect(me).toHaveProperty('principal_id');
    expect(me).toHaveProperty('role');
  });

  it('create key returns token', async () => {
    const [result] = await nodeRun({
      resource: 'principal', operation: 'createKey',
      principalKeyName: `e2e-key-${Date.now()}`,
      principalKeyValidFor: 300,
      principalKeyValidBefore: 0,
    });
    const key = result.json as Record<string, unknown>;
    expect(key).toHaveProperty('token');
    expect(key).toHaveProperty('key_id');
    keyId = key.key_id as string;
  });

  it('delete key succeeds', async () => {
    if (!keyId) return;
    const [result] = await nodeRun({
      resource: 'principal', operation: 'deleteKey',
      principalKeyId: keyId,
    });
    expect((result.json as Record<string, unknown>).deleted).toBe(true);
    keyId = '';
  });
});

describeE2E('E2E — Org lifecycle', () => {
  let orgId: string;

  afterAll(async () => {
    if (orgId) {
      await nodeRun({ resource: 'org', operation: 'delete', orgId }).catch(() => {});
    }
  });

  it('create org returns id and name', async () => {
    const [result] = await nodeRun({
      resource: 'org', operation: 'create',
      orgName: `e2e-org-${Date.now()}`,
    });
    const org = result.json as Record<string, unknown>;
    expect(org).toHaveProperty('id');
    expect(org).toHaveProperty('name');
    orgId = org.id as string;
  });

  it('list orgs includes the created org', async () => {
    const [result] = await nodeRun({ resource: 'org', operation: 'list' });
    const orgs = (result.json as Record<string, unknown>).orgs as Array<{ id: string }>;
    expect(Array.isArray(orgs)).toBe(true);
    expect(orgs.some(o => o.id === orgId)).toBe(true);
  });

  it('delete org returns deleted:true', async () => {
    const [result] = await nodeRun({ resource: 'org', operation: 'delete', orgId });
    expect((result.json as Record<string, unknown>).deleted).toBe(true);
    orgId = '';
  });
});

describeE2E('E2E — Principal + Role lifecycle', () => {
  let orgId: string;
  let principalId: string;
  const roleName = `e2e-role-${Date.now()}`;

  afterAll(async () => {
    // Teardown order: principal keys → principal → org (role not required)
    if (principalId && orgId) {
      await nodeRun({ resource: 'principal', operation: 'deletePrincipal', adminOrgId: orgId, deletePrincipalId: principalId })
        .catch(() => {});
    }
    if (orgId) {
      await nodeRun({ resource: 'org', operation: 'delete', orgId }).catch(() => {});
    }
  });

  it('creates an org', async () => {
    const [result] = await nodeRun({
      resource: 'org', operation: 'create',
      orgName: `e2e-lifecycle-${Date.now()}`,
    });
    orgId = (result.json as Record<string, unknown>).id as string;
    expect(orgId).toBeTruthy();
  });

  it('creates a role in the org', async () => {
    const [result] = await nodeRun({
      resource: 'role', operation: 'create',
      roleOrgId: orgId, roleName, rolePermissions: 'rRlL',
    });
    const role = result.json as Record<string, unknown>;
    expect(role.name).toBe(roleName);
    expect(typeof role.permissions).toBe('string');
  });

  it('lists roles and includes the new role', async () => {
    const [result] = await nodeRun({ resource: 'role', operation: 'list', roleOrgId: orgId });
    const roles = (result.json as Record<string, unknown>).roles as Array<{ name: string }>;
    expect(roles.some(r => r.name === roleName)).toBe(true);
  });

  it('creates a principal in the org', async () => {
    const [result] = await nodeRun({
      resource: 'principal', operation: 'createPrincipal',
      adminOrgId: orgId, newPrincipalName: 'alice', newPrincipalRole: roleName,
    });
    const p = result.json as Record<string, unknown>;
    expect(p).toHaveProperty('id');
    principalId = p.id as string;
  });

  it('lists principals and includes alice', async () => {
    const [result] = await nodeRun({ resource: 'principal', operation: 'listPrincipals', adminOrgId: orgId });
    const principals = (result.json as Record<string, unknown>).principals as Array<{ id: string }>;
    expect(principals.some(p => p.id === principalId)).toBe(true);
  });

  it('deletes the principal', async () => {
    const [result] = await nodeRun({
      resource: 'principal', operation: 'deletePrincipal',
      adminOrgId: orgId, deletePrincipalId: principalId,
    });
    expect((result.json as Record<string, unknown>).deleted).toBe(true);
    principalId = '';
  });

  it('deletes the org', async () => {
    const [result] = await nodeRun({ resource: 'org', operation: 'delete', orgId });
    expect((result.json as Record<string, unknown>).deleted).toBe(true);
    orgId = '';
  });
});
