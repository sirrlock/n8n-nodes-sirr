import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { Sirr } from './Sirr.node';

// ── Helpers ──────────────────────────────────────────────────────────────────

type Creds = { serverUrl?: string; apiToken?: string; org?: string };

function makeCtx(params: Record<string, unknown>, creds: Creds = {}) {
  return {
    getInputData: jest.fn().mockReturnValue([{ json: {} }]),
    getCredentials: jest.fn().mockResolvedValue({
      serverUrl: 'http://localhost:39999',
      apiToken: 'test-key',
      org: '',
      ...creds,
    }),
    getNodeParameter: jest
      .fn()
      .mockImplementation((name: string, _i: number, fallback?: unknown) => {
        return name in params ? params[name] : (fallback ?? '');
      }),
    helpers: {
      httpRequestWithAuthentication: jest.fn().mockResolvedValue({ ok: true }),
      httpRequest: jest.fn().mockResolvedValue({ status: 'ok' }),
    },
    continueOnFail: jest.fn().mockReturnValue(false),
    getNode: jest.fn().mockReturnValue({ name: 'Sirr', type: 'sirr', typeVersion: 1 }),
  };
}

async function run(ctx: ReturnType<typeof makeCtx>) {
  const node = new Sirr();
  return node.execute.call(ctx as unknown as IExecuteFunctions);
}

function lastReq(ctx: ReturnType<typeof makeCtx>) {
  const calls = ctx.helpers.httpRequestWithAuthentication.mock.calls;
  return calls[calls.length - 1][1] as Record<string, unknown>;
}

// ── Secret ───────────────────────────────────────────────────────────────────

describe('secret.get', () => {
  it('sends GET /secrets/:key', async () => {
    const ctx = makeCtx({ resource: 'secret', operation: 'get', key: 'MY_KEY' });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('GET');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/secrets/MY_KEY');
  });

  it('URL-encodes the key', async () => {
    const ctx = makeCtx({ resource: 'secret', operation: 'get', key: 'my key/special' });
    await run(ctx);
    expect(lastReq(ctx).url).toBe('http://localhost:39999/secrets/my%20key%2Fspecial');
  });

  it('routes through org when org is set', async () => {
    const ctx = makeCtx(
      { resource: 'secret', operation: 'get', key: 'DB_URL' },
      { org: 'org_abc' },
    );
    await run(ctx);
    expect(lastReq(ctx).url).toBe('http://localhost:39999/orgs/org_abc/secrets/DB_URL');
  });
});

describe('secret.check', () => {
  it('sends HEAD /secrets/:key with returnFullResponse', async () => {
    const ctx = makeCtx({ resource: 'secret', operation: 'check', key: 'MY_KEY' });
    ctx.helpers.httpRequestWithAuthentication.mockResolvedValue({
      headers: {
        'x-sirr-status': 'active',
        'x-sirr-read-count': '2',
        'x-sirr-reads-remaining': '3',
        'x-sirr-delete': 'true',
        'x-sirr-created-at': '1700000000',
      },
      statusCode: 200,
    });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('HEAD');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/secrets/MY_KEY');
    expect(lastReq(ctx).returnFullResponse).toBe(true);
  });

  it('parses header values into JSON output', async () => {
    const ctx = makeCtx({ resource: 'secret', operation: 'check', key: 'K' });
    ctx.helpers.httpRequestWithAuthentication.mockResolvedValue({
      headers: {
        'x-sirr-status': 'active',
        'x-sirr-read-count': '1',
        'x-sirr-reads-remaining': 'unlimited',
        'x-sirr-delete': 'false',
        'x-sirr-created-at': '1700000000',
        'x-sirr-expires-at': '1700003600',
      },
      statusCode: 200,
    });
    const result = await run(ctx);
    expect(result[0][0].json).toEqual({
      status: 'active',
      read_count: 1,
      reads_remaining: 'unlimited',
      delete: false,
      created_at: 1700000000,
      expires_at: 1700003600,
    });
  });

  it('returns null expires_at when header is absent', async () => {
    const ctx = makeCtx({ resource: 'secret', operation: 'check', key: 'K' });
    ctx.helpers.httpRequestWithAuthentication.mockResolvedValue({
      headers: {
        'x-sirr-status': 'active',
        'x-sirr-read-count': '0',
        'x-sirr-reads-remaining': 'unlimited',
        'x-sirr-delete': 'true',
        'x-sirr-created-at': '1700000000',
      },
      statusCode: 200,
    });
    const result = await run(ctx);
    expect((result[0][0].json as Record<string, unknown>).expires_at).toBeNull();
  });

  it('routes through org', async () => {
    const ctx = makeCtx(
      { resource: 'secret', operation: 'check', key: 'DB_URL' },
      { org: 'org_abc' },
    );
    ctx.helpers.httpRequestWithAuthentication.mockResolvedValue({
      headers: { 'x-sirr-status': 'active', 'x-sirr-read-count': '0', 'x-sirr-reads-remaining': 'unlimited', 'x-sirr-delete': 'true', 'x-sirr-created-at': '1700000000' },
      statusCode: 200,
    });
    await run(ctx);
    expect(lastReq(ctx).url).toBe('http://localhost:39999/orgs/org_abc/secrets/DB_URL');
  });
});

describe('secret.push', () => {
  it('sends POST /secrets with value only (no key)', async () => {
    const ctx = makeCtx({
      resource: 'secret',
      operation: 'push',
      value: 'secret-value',
      ttlSeconds: 3600,
      maxReads: 1,
    });
    ctx.helpers.httpRequestWithAuthentication.mockResolvedValue({ id: 'abc123' });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('POST');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/secrets');
    expect(lastReq(ctx).body).toEqual({ value: 'secret-value', ttl_seconds: 3600, max_reads: 1 });
  });

  it('omits ttl and maxReads when 0', async () => {
    const ctx = makeCtx({
      resource: 'secret',
      operation: 'push',
      value: 'v',
      ttlSeconds: 0,
      maxReads: 0,
    });
    ctx.helpers.httpRequestWithAuthentication.mockResolvedValue({ id: 'def456' });
    await run(ctx);
    expect(lastReq(ctx).body).toEqual({ value: 'v' });
  });

  it('does not route through org even when org is set', async () => {
    // Push is always public — org credential must be ignored
    const ctx = makeCtx(
      { resource: 'secret', operation: 'push', value: 'v', ttlSeconds: 0, maxReads: 0 },
      { org: 'org_xyz' },
    );
    ctx.helpers.httpRequestWithAuthentication.mockResolvedValue({ id: 'ghi789' });
    await run(ctx);
    expect(lastReq(ctx).url).toBe('http://localhost:39999/secrets');
  });

  it('returns the id from the response', async () => {
    const ctx = makeCtx({
      resource: 'secret',
      operation: 'push',
      value: 'my-secret',
      ttlSeconds: 0,
      maxReads: 0,
    });
    ctx.helpers.httpRequestWithAuthentication.mockResolvedValue({ id: 'deadbeef' });
    const result = await run(ctx);
    expect((result[0][0].json as Record<string, unknown>).id).toBe('deadbeef');
  });
});

describe('secret.set', () => {
  it('sends POST /orgs/:org/secrets with key and value', async () => {
    const ctx = makeCtx(
      { resource: 'secret', operation: 'set', setKey: 'DB_URL', setValue: 'postgres://...', setOnConflict: 'error' },
      { org: 'org_abc' },
    );
    await run(ctx);
    expect(lastReq(ctx).method).toBe('POST');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/orgs/org_abc/secrets');
    expect(lastReq(ctx).body).toEqual({ key: 'DB_URL', value: 'postgres://...' });
  });

  it('throws when no org is configured', async () => {
    const ctx = makeCtx(
      { resource: 'secret', operation: 'set', setKey: 'K', setValue: 'v', setOnConflict: 'error' },
      { org: '' },
    );
    await expect(run(ctx)).rejects.toThrow('Set requires an Organization ID');
  });

  it('throws on 409 when onConflict is error', async () => {
    const ctx = makeCtx(
      { resource: 'secret', operation: 'set', setKey: 'K', setValue: 'v', setOnConflict: 'error' },
      { org: 'org_abc' },
    );
    const conflictErr = Object.assign(new Error('Conflict'), { response: { statusCode: 409 } });
    ctx.helpers.httpRequestWithAuthentication.mockRejectedValue(conflictErr);
    await expect(run(ctx)).rejects.toThrow();
  });

  it('returns conflict object on 409 when onConflict is ignore', async () => {
    const ctx = makeCtx(
      { resource: 'secret', operation: 'set', setKey: 'MY_KEY', setValue: 'v', setOnConflict: 'ignore' },
      { org: 'org_abc' },
    );
    const conflictErr = Object.assign(new Error('Conflict'), { response: { statusCode: 409 } });
    ctx.helpers.httpRequestWithAuthentication.mockRejectedValue(conflictErr);
    const result = await run(ctx);
    expect((result[0][0].json as Record<string, unknown>).conflict).toBe(true);
    expect((result[0][0].json as Record<string, unknown>).key).toBe('MY_KEY');
  });
});

describe('secret.patch', () => {
  it('sends PATCH /secrets/:key', async () => {
    const ctx = makeCtx({
      resource: 'secret',
      operation: 'patch',
      key: 'MY_KEY',
      patchValue: '',
      patchTtlSeconds: 0,
      patchMaxReads: 0,
    });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('PATCH');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/secrets/MY_KEY');
  });

  it('only sends fields that are set', async () => {
    const ctx = makeCtx({
      resource: 'secret',
      operation: 'patch',
      key: 'K',
      patchValue: 'new-val',
      patchTtlSeconds: 600,
      patchMaxReads: 0,
    });
    await run(ctx);
    expect(lastReq(ctx).body).toEqual({ value: 'new-val', ttl_seconds: 600 });
  });

  it('sends empty body when nothing to update', async () => {
    const ctx = makeCtx({
      resource: 'secret',
      operation: 'patch',
      key: 'K',
      patchValue: '',
      patchTtlSeconds: 0,
      patchMaxReads: 0,
    });
    await run(ctx);
    expect(lastReq(ctx).body).toEqual({});
  });

  it('routes through org', async () => {
    const ctx = makeCtx(
      { resource: 'secret', operation: 'patch', key: 'K', patchValue: '', patchTtlSeconds: 0, patchMaxReads: 0 },
      { org: 'org_abc' },
    );
    await run(ctx);
    expect(lastReq(ctx).url).toBe('http://localhost:39999/orgs/org_abc/secrets/K');
  });
});

describe('secret.list', () => {
  it('sends GET /secrets', async () => {
    const ctx = makeCtx({ resource: 'secret', operation: 'list' });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('GET');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/secrets');
  });
});

describe('secret.delete', () => {
  it('sends DELETE /secrets/:key', async () => {
    const ctx = makeCtx({ resource: 'secret', operation: 'delete', key: 'OLD_KEY' });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('DELETE');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/secrets/OLD_KEY');
  });
});

describe('secret.prune', () => {
  it('sends POST /prune', async () => {
    const ctx = makeCtx({ resource: 'secret', operation: 'prune' });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('POST');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/prune');
  });

  it('routes through org', async () => {
    const ctx = makeCtx({ resource: 'secret', operation: 'prune' }, { org: 'org_abc' });
    await run(ctx);
    expect(lastReq(ctx).url).toBe('http://localhost:39999/orgs/org_abc/prune');
  });
});

// ── Audit ─────────────────────────────────────────────────────────────────────

describe('audit.query', () => {
  it('sends GET /audit with empty qs by default', async () => {
    const ctx = makeCtx({ resource: 'audit', operation: 'query', since: 0, until: 0, actionFilter: '', limit: 0 });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('GET');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/audit');
    expect(lastReq(ctx).qs).toEqual({});
  });

  it('passes since, until, action, limit as qs when set', async () => {
    const ctx = makeCtx({
      resource: 'audit',
      operation: 'query',
      since: 1700000000,
      until: 1700003600,
      actionFilter: 'secret.read',
      limit: 20,
    });
    await run(ctx);
    expect(lastReq(ctx).qs).toEqual({ since: 1700000000, until: 1700003600, action: 'secret.read', limit: 20 });
  });

  it('routes through org', async () => {
    const ctx = makeCtx(
      { resource: 'audit', operation: 'query', since: 0, until: 0, actionFilter: '', limit: 0 },
      { org: 'org_abc' },
    );
    await run(ctx);
    expect(lastReq(ctx).url).toBe('http://localhost:39999/orgs/org_abc/audit');
  });
});

// ── Webhook ───────────────────────────────────────────────────────────────────

describe('webhook.create', () => {
  it('sends POST /webhooks with url and split events', async () => {
    const ctx = makeCtx({
      resource: 'webhook',
      operation: 'create',
      webhookUrl: 'https://example.com/hook',
      events: 'secret.read, secret.delete',
    });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('POST');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/webhooks');
    expect(lastReq(ctx).body).toEqual({
      url: 'https://example.com/hook',
      events: ['secret.read', 'secret.delete'],
    });
  });

  it('sends undefined events when empty string', async () => {
    const ctx = makeCtx({
      resource: 'webhook',
      operation: 'create',
      webhookUrl: 'https://example.com/hook',
      events: '',
    });
    await run(ctx);
    expect((lastReq(ctx).body as Record<string, unknown>).events).toBeUndefined();
  });
});

describe('webhook.list', () => {
  it('sends GET /webhooks', async () => {
    const ctx = makeCtx({ resource: 'webhook', operation: 'list' });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('GET');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/webhooks');
  });
});

describe('webhook.delete', () => {
  it('sends DELETE /webhooks/:id', async () => {
    const ctx = makeCtx({ resource: 'webhook', operation: 'delete', webhookId: 'wh_123' });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('DELETE');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/webhooks/wh_123');
  });
});

// ── Principal ────────────────────────────────────────────────────────────────

describe('principal.me', () => {
  it('sends GET /me', async () => {
    const ctx = makeCtx({ resource: 'principal', operation: 'me' });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('GET');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/me');
  });
});

describe('principal.updateMe', () => {
  it('sends PATCH /me with metadata map', async () => {
    const ctx = makeCtx({
      resource: 'principal',
      operation: 'updateMe',
      principalMetadata: { item: [{ key: 'team', value: 'platform' }, { key: 'env', value: 'prod' }] },
    });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('PATCH');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/me');
    expect(lastReq(ctx).body).toEqual({ metadata: { team: 'platform', env: 'prod' } });
  });

  it('sends empty metadata when no items provided', async () => {
    const ctx = makeCtx({ resource: 'principal', operation: 'updateMe', principalMetadata: {} });
    await run(ctx);
    expect((lastReq(ctx).body as Record<string, unknown>).metadata).toEqual({});
  });

  it('skips items with empty key', async () => {
    const ctx = makeCtx({
      resource: 'principal',
      operation: 'updateMe',
      principalMetadata: { item: [{ key: '', value: 'ignored' }, { key: 'keep', value: 'yes' }] },
    });
    await run(ctx);
    expect((lastReq(ctx).body as Record<string, unknown>).metadata).toEqual({ keep: 'yes' });
  });
});

describe('principal.createKey', () => {
  it('sends POST /me/keys with name only when no time window', async () => {
    const ctx = makeCtx({
      resource: 'principal',
      operation: 'createKey',
      principalKeyName: 'deploy-key',
      principalKeyValidFor: 0,
      principalKeyValidBefore: 0,
    });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('POST');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/me/keys');
    expect(lastReq(ctx).body).toEqual({ name: 'deploy-key' });
  });

  it('includes valid_for_seconds when set', async () => {
    const ctx = makeCtx({
      resource: 'principal',
      operation: 'createKey',
      principalKeyName: 'temp-key',
      principalKeyValidFor: 3600,
      principalKeyValidBefore: 0,
    });
    await run(ctx);
    expect(lastReq(ctx).body).toEqual({ name: 'temp-key', valid_for_seconds: 3600 });
  });

  it('includes valid_before when set', async () => {
    const ctx = makeCtx({
      resource: 'principal',
      operation: 'createKey',
      principalKeyName: 'timed-key',
      principalKeyValidFor: 0,
      principalKeyValidBefore: 1700100000,
    });
    await run(ctx);
    expect(lastReq(ctx).body).toEqual({ name: 'timed-key', valid_before: 1700100000 });
  });

  it('includes both when both set', async () => {
    const ctx = makeCtx({
      resource: 'principal',
      operation: 'createKey',
      principalKeyName: 'full-key',
      principalKeyValidFor: 7200,
      principalKeyValidBefore: 1700200000,
    });
    await run(ctx);
    expect(lastReq(ctx).body).toEqual({
      name: 'full-key',
      valid_for_seconds: 7200,
      valid_before: 1700200000,
    });
  });
});

describe('principal.deleteKey', () => {
  it('sends DELETE /me/keys/:id', async () => {
    const ctx = makeCtx({ resource: 'principal', operation: 'deleteKey', principalKeyId: 'key_abc' });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('DELETE');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/me/keys/key_abc');
  });
});

describe('principal.createPrincipal', () => {
  it('sends POST /orgs/:orgId/principals with name and role', async () => {
    const ctx = makeCtx({
      resource: 'principal',
      operation: 'createPrincipal',
      adminOrgId: 'org_abc',
      newPrincipalName: 'alice',
      newPrincipalRole: 'admin',
    });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('POST');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/orgs/org_abc/principals');
    expect(lastReq(ctx).body).toEqual({ name: 'alice', role: 'admin' });
  });
});

describe('principal.listPrincipals', () => {
  it('sends GET /orgs/:orgId/principals', async () => {
    const ctx = makeCtx({
      resource: 'principal',
      operation: 'listPrincipals',
      adminOrgId: 'org_abc',
    });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('GET');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/orgs/org_abc/principals');
  });
});

describe('principal.deletePrincipal', () => {
  it('sends DELETE /orgs/:orgId/principals/:id', async () => {
    const ctx = makeCtx({
      resource: 'principal',
      operation: 'deletePrincipal',
      adminOrgId: 'org_abc',
      deletePrincipalId: 'p_123',
    });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('DELETE');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/orgs/org_abc/principals/p_123');
  });
});

// ── Org ──────────────────────────────────────────────────────────────────────

describe('org.create', () => {
  it('sends POST /orgs with name', async () => {
    const ctx = makeCtx({ resource: 'org', operation: 'create', orgName: 'my-org' });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('POST');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/orgs');
    expect(lastReq(ctx).body).toEqual({ name: 'my-org' });
  });
});

describe('org.list', () => {
  it('sends GET /orgs', async () => {
    const ctx = makeCtx({ resource: 'org', operation: 'list' });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('GET');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/orgs');
  });
});

describe('org.delete', () => {
  it('sends DELETE /orgs/:id', async () => {
    const ctx = makeCtx({ resource: 'org', operation: 'delete', orgId: 'org_abc' });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('DELETE');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/orgs/org_abc');
  });
});

// ── Role ─────────────────────────────────────────────────────────────────────

describe('role.create', () => {
  it('sends POST /orgs/:orgId/roles with name and permissions string', async () => {
    const ctx = makeCtx({
      resource: 'role',
      operation: 'create',
      roleOrgId: 'org_abc',
      roleName: 'reader',
      rolePermissions: 'rRlL',
    });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('POST');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/orgs/org_abc/roles');
    expect(lastReq(ctx).body).toEqual({ name: 'reader', permissions: 'rRlL' });
  });

  it('sends permissions as a string not an array', async () => {
    const ctx = makeCtx({
      resource: 'role',
      operation: 'create',
      roleOrgId: 'org_abc',
      roleName: 'writer',
      rolePermissions: 'rw',
    });
    await run(ctx);
    expect(typeof (lastReq(ctx).body as Record<string, unknown>).permissions).toBe('string');
  });
});

describe('role.list', () => {
  it('sends GET /orgs/:orgId/roles', async () => {
    const ctx = makeCtx({ resource: 'role', operation: 'list', roleOrgId: 'org_abc' });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('GET');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/orgs/org_abc/roles');
  });
});

describe('role.delete', () => {
  it('sends DELETE /orgs/:orgId/roles/:name', async () => {
    const ctx = makeCtx({ resource: 'role', operation: 'delete', roleOrgId: 'org_abc', roleName: 'reader' });
    await run(ctx);
    expect(lastReq(ctx).method).toBe('DELETE');
    expect(lastReq(ctx).url).toBe('http://localhost:39999/orgs/org_abc/roles/reader');
  });
});

// ── Server ────────────────────────────────────────────────────────────────────

describe('server.healthCheck', () => {
  it('calls httpRequest (no auth) with GET /health', async () => {
    const ctx = makeCtx({ resource: 'server', operation: 'healthCheck' });
    await run(ctx);
    expect(ctx.helpers.httpRequestWithAuthentication).not.toHaveBeenCalled();
    expect(ctx.helpers.httpRequest).toHaveBeenCalledWith({
      method: 'GET',
      url: 'http://localhost:39999/health',
      json: true,
    });
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('error handling', () => {
  it('throws NodeApiError on non-2xx', async () => {
    const ctx = makeCtx({ resource: 'secret', operation: 'list' });
    ctx.helpers.httpRequestWithAuthentication.mockRejectedValue(new Error('Request failed'));
    await expect(run(ctx)).rejects.toBeInstanceOf(NodeApiError);
  });

  it('returns error in output when continueOnFail is true', async () => {
    const ctx = makeCtx({ resource: 'secret', operation: 'list' });
    ctx.helpers.httpRequestWithAuthentication.mockRejectedValue(new Error('not found'));
    ctx.continueOnFail.mockReturnValue(true);
    const result = await run(ctx);
    expect(result[0][0].json).toHaveProperty('error');
  });

  it('surfaces plain-text body (response.body) in NodeApiError message', async () => {
    const ctx = makeCtx({ resource: 'secret', operation: 'list' });
    const err = Object.assign(new Error('Request failed'), {
      response: { statusCode: 429, body: 'Too Many Requests' },
    });
    ctx.helpers.httpRequestWithAuthentication.mockRejectedValue(err);
    await expect(run(ctx)).rejects.toMatchObject({ message: 'Too Many Requests' });
  });

  it('surfaces plain-text body from cause.response (got v12 style)', async () => {
    const ctx = makeCtx({ resource: 'secret', operation: 'list' });
    const err = Object.assign(new Error('upstream error'), {
      cause: { response: { statusCode: 503, body: 'Service Unavailable' } },
    });
    ctx.helpers.httpRequestWithAuthentication.mockRejectedValue(err);
    await expect(run(ctx)).rejects.toMatchObject({ message: 'Service Unavailable' });
  });
});
