import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

function buildPath(org: string | undefined, path: string): string {
  if (!org) return path;
  if (path.startsWith('/secrets')) return `/orgs/${org}${path}`;
  if (path.startsWith('/audit')) return `/orgs/${org}${path}`;
  if (path.startsWith('/webhooks')) return `/orgs/${org}${path}`;
  if (path.startsWith('/prune')) return `/orgs/${org}${path}`;
  return path;
}

export class Sirr implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Sirr',
    name: 'sirr',
    icon: 'file:sirr.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
    description: 'Manage ephemeral secrets with Sirr',
    defaults: { name: 'Sirr' },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [
      {
        name: 'sirrApi',
        required: true,
      },
    ],
    properties: [
      /* ── Resource ─────────────────────────────── */
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Secret', value: 'secret' },
          { name: 'Audit', value: 'audit' },
          { name: 'Webhook', value: 'webhook' },
          { name: 'Principal', value: 'principal' },
          { name: 'Org', value: 'org' },
          { name: 'Role', value: 'role' },
          { name: 'Server', value: 'server' },
        ],
        default: 'secret',
      },

      /* ── Secret operations ────────────────────── */
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['secret'] } },
        options: [
          { name: 'Get', value: 'get', action: 'Get a secret' },
          { name: 'Check', value: 'check', action: 'Check a secret exists without consuming a read' },
          { name: 'Push', value: 'push', action: 'Push an anonymous secret (public dead drop, returns ID)' },
          { name: 'Set', value: 'set', action: 'Set a named secret in an org' },
          { name: 'Patch', value: 'patch', action: 'Update an existing secret' },
          { name: 'List', value: 'list', action: 'List all secrets' },
          { name: 'Delete', value: 'delete', action: 'Delete a secret' },
          { name: 'Prune', value: 'prune', action: 'Prune expired secrets' },
        ],
        default: 'get',
      },
      {
        displayName: 'ID or Key',
        name: 'key',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['secret'], operation: ['get', 'check', 'patch', 'delete'] },
        },
        description: 'Public secret ID (hex64) for anonymous secrets, or named key for org secrets',
      },
      /* ── Push (public dead drop) ────── */
      {
        displayName: 'Value',
        name: 'value',
        type: 'string',
        typeOptions: { password: true },
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['secret'], operation: ['push'] },
        },
        description: 'The secret value to store',
      },
      {
        displayName: 'TTL (Seconds)',
        name: 'ttlSeconds',
        type: 'number',
        default: 0,
        displayOptions: {
          show: { resource: ['secret'], operation: ['push'] },
        },
        description: 'Time-to-live in seconds (0 = no expiry)',
      },
      {
        displayName: 'Max Reads',
        name: 'maxReads',
        type: 'number',
        default: 0,
        displayOptions: {
          show: { resource: ['secret'], operation: ['push'] },
        },
        description: 'Maximum number of reads before the secret is destroyed (0 = unlimited)',
      },
      /* ── Set (org named secret) ─────── */
      {
        displayName: 'Key',
        name: 'setKey',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['secret'], operation: ['set'] },
        },
        description: 'The named key to store the secret under (org-scoped)',
      },
      {
        displayName: 'Value',
        name: 'setValue',
        type: 'string',
        typeOptions: { password: true },
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['secret'], operation: ['set'] },
        },
        description: 'The secret value',
      },
      {
        displayName: 'On Conflict',
        name: 'setOnConflict',
        type: 'options',
        options: [
          { name: 'Error', value: 'error', description: 'Throw an error if the key already exists (409)' },
          { name: 'Ignore', value: 'ignore', description: 'Return the existing secret ID silently' },
        ],
        default: 'error',
        displayOptions: {
          show: { resource: ['secret'], operation: ['set'] },
        },
        description: 'What to do when the key already exists in the org',
      },
      {
        displayName: 'New Value',
        name: 'patchValue',
        type: 'string',
        typeOptions: { password: true },
        default: '',
        displayOptions: {
          show: { resource: ['secret'], operation: ['patch'] },
        },
        description: 'New value to store (leave empty to keep current value)',
      },
      {
        displayName: 'New TTL (Seconds)',
        name: 'patchTtlSeconds',
        type: 'number',
        default: 0,
        displayOptions: {
          show: { resource: ['secret'], operation: ['patch'] },
        },
        description: 'New TTL in seconds from now (0 = no change)',
      },
      {
        displayName: 'New Max Reads',
        name: 'patchMaxReads',
        type: 'number',
        default: 0,
        displayOptions: {
          show: { resource: ['secret'], operation: ['patch'] },
        },
        description: 'New maximum read count (0 = no change)',
      },

      /* ── Audit operations ─────────────────────── */
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['audit'] } },
        options: [
          { name: 'Query', value: 'query', action: 'Query audit events' },
        ],
        default: 'query',
      },
      {
        displayName: 'Since (Unix Timestamp)',
        name: 'since',
        type: 'number',
        default: 0,
        displayOptions: {
          show: { resource: ['audit'], operation: ['query'] },
        },
        description: 'Only return events after this Unix timestamp (0 = all)',
      },
      {
        displayName: 'Until (Unix Timestamp)',
        name: 'until',
        type: 'number',
        default: 0,
        displayOptions: {
          show: { resource: ['audit'], operation: ['query'] },
        },
        description: 'Only return events before this Unix timestamp (0 = no upper bound)',
      },
      {
        displayName: 'Action Filter',
        name: 'actionFilter',
        type: 'string',
        default: '',
        displayOptions: {
          show: { resource: ['audit'], operation: ['query'] },
        },
        description: 'Filter by action (e.g. secret.create, secret.read)',
      },
      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        default: 50,
        displayOptions: {
          show: { resource: ['audit'], operation: ['query'] },
        },
        description: 'Maximum number of events to return',
      },

      /* ── Webhook operations ───────────────────── */
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['webhook'] } },
        options: [
          { name: 'Create', value: 'create', action: 'Create a webhook' },
          { name: 'List', value: 'list', action: 'List webhooks' },
          { name: 'Delete', value: 'delete', action: 'Delete a webhook' },
        ],
        default: 'list',
      },
      {
        displayName: 'Webhook URL',
        name: 'webhookUrl',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['webhook'], operation: ['create'] },
        },
        description: 'The URL to deliver webhook events to',
      },
      {
        displayName: 'Events',
        name: 'events',
        type: 'string',
        default: '',
        displayOptions: {
          show: { resource: ['webhook'], operation: ['create'] },
        },
        description: 'Comma-separated event types (empty = all events)',
      },
      {
        displayName: 'Webhook ID',
        name: 'webhookId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['webhook'], operation: ['delete'] },
        },
        description: 'The ID of the webhook to delete',
      },

      /* ── Principal operations ───────────────────── */
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['principal'] } },
        options: [
          { name: 'Get Me', value: 'me', action: 'Get current principal' },
          { name: 'Update Me', value: 'updateMe', action: 'Update current principal metadata' },
          { name: 'Create Key', value: 'createKey', action: 'Create a personal API key' },
          { name: 'Delete Key', value: 'deleteKey', action: 'Delete a personal API key' },
          { name: 'Create Principal', value: 'createPrincipal', action: 'Create a principal in an org' },
          { name: 'List Principals', value: 'listPrincipals', action: 'List principals in an org' },
          { name: 'Delete Principal', value: 'deletePrincipal', action: 'Delete a principal in an org' },
        ],
        default: 'me',
      },
      {
        displayName: 'Metadata',
        name: 'principalMetadata',
        type: 'fixedCollection',
        typeOptions: { multipleValues: true },
        default: {},
        displayOptions: {
          show: { resource: ['principal'], operation: ['updateMe'] },
        },
        description: 'Arbitrary key-value metadata to set on the principal',
        options: [
          {
            name: 'item',
            displayName: 'Item',
            values: [
              {
                displayName: 'Key',
                name: 'key',
                type: 'string',
                default: '',
                description: 'Metadata key',
              },
              {
                displayName: 'Value',
                name: 'value',
                type: 'string',
                default: '',
                description: 'Metadata value',
              },
            ],
          },
        ],
      },
      {
        displayName: 'Name',
        name: 'principalKeyName',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['principal'], operation: ['createKey'] },
        },
        description: 'Human-readable name for the personal API key',
      },
      {
        displayName: 'Valid For (Seconds)',
        name: 'principalKeyValidFor',
        type: 'number',
        default: 0,
        displayOptions: {
          show: { resource: ['principal'], operation: ['createKey'] },
        },
        description: 'Key validity duration in seconds from now (0 = no expiry)',
      },
      {
        displayName: 'Valid Before (Unix Timestamp)',
        name: 'principalKeyValidBefore',
        type: 'number',
        default: 0,
        displayOptions: {
          show: { resource: ['principal'], operation: ['createKey'] },
        },
        description: 'Hard expiry as a Unix timestamp — key cannot be used after this time (0 = no limit)',
      },
      {
        displayName: 'Key ID',
        name: 'principalKeyId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['principal'], operation: ['deleteKey'] },
        },
        description: 'The ID of the personal API key to delete',
      },
      {
        displayName: 'Org ID',
        name: 'adminOrgId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['principal'], operation: ['createPrincipal', 'listPrincipals', 'deletePrincipal'] },
        },
        description: 'The org in which to manage principals',
      },
      {
        displayName: 'Name',
        name: 'newPrincipalName',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['principal'], operation: ['createPrincipal'] },
        },
        description: 'Human-readable name for the principal',
      },
      {
        displayName: 'Role',
        name: 'newPrincipalRole',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['principal'], operation: ['createPrincipal'] },
        },
        description: 'Role name to assign (e.g. admin)',
      },
      {
        displayName: 'Principal ID',
        name: 'deletePrincipalId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['principal'], operation: ['deletePrincipal'] },
        },
        description: 'The ID of the principal to delete',
      },

      /* ── Org operations ──────────────────────────── */
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['org'] } },
        options: [
          { name: 'Create', value: 'create', action: 'Create an org' },
          { name: 'List', value: 'list', action: 'List all orgs' },
          { name: 'Delete', value: 'delete', action: 'Delete an org' },
        ],
        default: 'list',
      },
      {
        displayName: 'Name',
        name: 'orgName',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['org'], operation: ['create'] },
        },
        description: 'Human-readable name for the org',
      },
      {
        displayName: 'Org ID',
        name: 'orgId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['org'], operation: ['delete'] },
        },
        description: 'The ID of the org to delete',
      },

      /* ── Role operations ─────────────────────────── */
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['role'] } },
        options: [
          { name: 'Create', value: 'create', action: 'Create a role' },
          { name: 'List', value: 'list', action: 'List roles in an org' },
          { name: 'Delete', value: 'delete', action: 'Delete a role' },
        ],
        default: 'list',
      },
      {
        displayName: 'Org ID',
        name: 'roleOrgId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['role'], operation: ['create', 'list', 'delete'] },
        },
        description: 'The org in which to manage roles',
      },
      {
        displayName: 'Role Name',
        name: 'roleName',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['role'], operation: ['create', 'delete'] },
        },
        description: 'Name of the role',
      },
      {
        displayName: 'Permissions',
        name: 'rolePermissions',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['role'], operation: ['create'] },
        },
        description: 'Permission letter string (e.g. "rRlL"). r=read, R=read-org, w=write, W=write-org, d=delete, D=delete-org, l=list, L=list-org, p=patch-my, P=patch-org, a=account-manage, m=manage-org',
      },

      /* ── Server operations ────────────────────── */
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['server'] } },
        options: [
          { name: 'Health Check', value: 'healthCheck', action: 'Check server health' },
        ],
        default: 'healthCheck',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];
    const credentials = await this.getCredentials('sirrApi');
    const baseUrl = (credentials.serverUrl as string).replace(/\/$/, '');
    const org = (credentials.org as string) || undefined;

    for (let i = 0; i < items.length; i++) {
      try {
        const resource = this.getNodeParameter('resource', i) as string;
        const operation = this.getNodeParameter('operation', i) as string;
        let response: unknown;

        if (resource === 'secret') {
          if (operation === 'get') {
            const key = this.getNodeParameter('key', i) as string;
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'GET',
                url: `${baseUrl}${buildPath(org, `/secrets/${encodeURIComponent(key)}`)}`,
                json: true,
              },
            );
          } else if (operation === 'check') {
            const key = this.getNodeParameter('key', i) as string;
            const res = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'HEAD',
                url: `${baseUrl}${buildPath(org, `/secrets/${encodeURIComponent(key)}`)}`,
                returnFullResponse: true,
              },
            ) as { headers: Record<string, string>; statusCode: number };
            const h = res.headers;
            response = {
              status: h['x-sirr-status'] ?? null,
              read_count: parseInt(h['x-sirr-read-count'] ?? '0', 10),
              reads_remaining: h['x-sirr-reads-remaining'] ?? null,
              delete: h['x-sirr-delete'] === 'true',
              created_at: h['x-sirr-created-at'] ? parseInt(h['x-sirr-created-at'], 10) : null,
              expires_at: h['x-sirr-expires-at'] ? parseInt(h['x-sirr-expires-at'], 10) : null,
            };
          } else if (operation === 'push') {
            // Public dead drop — no key, no org routing. Returns { id }.
            const value = this.getNodeParameter('value', i) as string;
            const ttl = this.getNodeParameter('ttlSeconds', i) as number;
            const maxReads = this.getNodeParameter('maxReads', i) as number;
            const body: IDataObject = { value };
            if (ttl) body.ttl_seconds = ttl;
            if (maxReads) body.max_reads = maxReads;
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'POST',
                url: `${baseUrl}/secrets`,
                body,
                json: true,
              },
            );
          } else if (operation === 'set') {
            // Org named secret — requires org in credentials. Returns 409 if key exists.
            if (!org) {
              throw new NodeApiError(this.getNode(), {} as JsonObject, {
                message: 'Set requires an Organization ID in credentials',
              });
            }
            const setKey = this.getNodeParameter('setKey', i) as string;
            const setValue = this.getNodeParameter('setValue', i) as string;
            const onConflict = this.getNodeParameter('setOnConflict', i, 'error') as string;
            try {
              response = await this.helpers.httpRequestWithAuthentication.call(
                this,
                'sirrApi',
                {
                  method: 'POST',
                  url: `${baseUrl}/orgs/${encodeURIComponent(org)}/secrets`,
                  body: { key: setKey, value: setValue },
                  json: true,
                },
              );
            } catch (setError) {
              const err = setError as Error & {
                response?: { statusCode?: number };
                cause?: { response?: { statusCode?: number } };
              };
              const statusCode = err?.response?.statusCode ?? err?.cause?.response?.statusCode;
              if (statusCode === 409 && onConflict === 'ignore') {
                response = { conflict: true, key: setKey, message: 'Key already exists' };
              } else {
                throw setError;
              }
            }
          } else if (operation === 'patch') {
            const key = this.getNodeParameter('key', i) as string;
            const patchValue = this.getNodeParameter('patchValue', i) as string;
            const patchTtl = this.getNodeParameter('patchTtlSeconds', i) as number;
            const patchMaxReads = this.getNodeParameter('patchMaxReads', i) as number;
            const body: IDataObject = {};
            if (patchValue) body.value = patchValue;
            if (patchTtl) body.ttl_seconds = patchTtl;
            if (patchMaxReads) body.max_reads = patchMaxReads;
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'PATCH',
                url: `${baseUrl}${buildPath(org, `/secrets/${encodeURIComponent(key)}`)}`,
                body,
                json: true,
              },
            );
          } else if (operation === 'list') {
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'GET',
                url: `${baseUrl}${buildPath(org, '/secrets')}`,
                json: true,
              },
            );
          } else if (operation === 'delete') {
            const key = this.getNodeParameter('key', i) as string;
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'DELETE',
                url: `${baseUrl}${buildPath(org, `/secrets/${encodeURIComponent(key)}`)}`,
                json: true,
              },
            );
          } else if (operation === 'prune') {
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'POST',
                url: `${baseUrl}${buildPath(org, '/prune')}`,
                json: true,
              },
            );
          }
        } else if (resource === 'audit') {
          const since = this.getNodeParameter('since', i) as number;
          const until = this.getNodeParameter('until', i) as number;
          const actionFilter = this.getNodeParameter('actionFilter', i) as string;
          const limit = this.getNodeParameter('limit', i) as number;
          const qs: Record<string, string | number> = {};
          if (since) qs.since = since;
          if (until) qs.until = until;
          if (actionFilter) qs.action = actionFilter;
          if (limit) qs.limit = limit;
          response = await this.helpers.httpRequestWithAuthentication.call(
            this,
            'sirrApi',
            {
              method: 'GET',
              url: `${baseUrl}${buildPath(org, '/audit')}`,
              qs,
              json: true,
            },
          );
        } else if (resource === 'webhook') {
          if (operation === 'create') {
            const url = this.getNodeParameter('webhookUrl', i) as string;
            const eventsStr = this.getNodeParameter('events', i) as string;
            const events = eventsStr ? eventsStr.split(',').map((e) => e.trim()) : undefined;
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'POST',
                url: `${baseUrl}${buildPath(org, '/webhooks')}`,
                body: { url, events },
                json: true,
              },
            );
          } else if (operation === 'list') {
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'GET',
                url: `${baseUrl}${buildPath(org, '/webhooks')}`,
                json: true,
              },
            );
          } else if (operation === 'delete') {
            const id = this.getNodeParameter('webhookId', i) as string;
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'DELETE',
                url: `${baseUrl}${buildPath(org, `/webhooks/${encodeURIComponent(id)}`)}`,
                json: true,
              },
            );
          }
        } else if (resource === 'principal') {
          if (operation === 'me') {
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'GET',
                url: `${baseUrl}/me`,
                json: true,
              },
            );
          } else if (operation === 'updateMe') {
            const metadataCollection = this.getNodeParameter('principalMetadata', i, {}) as {
              item?: Array<{ key: string; value: string }>;
            };
            const metadata: Record<string, string> = {};
            for (const item of metadataCollection.item ?? []) {
              if (item.key) metadata[item.key] = item.value;
            }
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'PATCH',
                url: `${baseUrl}/me`,
                body: { metadata },
                json: true,
              },
            );
          } else if (operation === 'createKey') {
            const name = this.getNodeParameter('principalKeyName', i) as string;
            const validFor = this.getNodeParameter('principalKeyValidFor', i) as number;
            const validBefore = this.getNodeParameter('principalKeyValidBefore', i) as number;
            const body: IDataObject = { name };
            if (validFor) body.valid_for_seconds = validFor;
            if (validBefore) body.valid_before = validBefore;
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'POST',
                url: `${baseUrl}/me/keys`,
                body,
                json: true,
              },
            );
          } else if (operation === 'deleteKey') {
            const keyId = this.getNodeParameter('principalKeyId', i) as string;
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'DELETE',
                url: `${baseUrl}/me/keys/${encodeURIComponent(keyId)}`,
                json: true,
              },
            );
          } else if (operation === 'createPrincipal') {
            const adminOrgId = this.getNodeParameter('adminOrgId', i) as string;
            const name = this.getNodeParameter('newPrincipalName', i) as string;
            const role = this.getNodeParameter('newPrincipalRole', i) as string;
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'POST',
                url: `${baseUrl}/orgs/${encodeURIComponent(adminOrgId)}/principals`,
                body: { name, role },
                json: true,
              },
            );
          } else if (operation === 'listPrincipals') {
            const adminOrgId = this.getNodeParameter('adminOrgId', i) as string;
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'GET',
                url: `${baseUrl}/orgs/${encodeURIComponent(adminOrgId)}/principals`,
                json: true,
              },
            );
          } else if (operation === 'deletePrincipal') {
            const adminOrgId = this.getNodeParameter('adminOrgId', i) as string;
            const principalId = this.getNodeParameter('deletePrincipalId', i) as string;
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'DELETE',
                url: `${baseUrl}/orgs/${encodeURIComponent(adminOrgId)}/principals/${encodeURIComponent(principalId)}`,
                json: true,
              },
            );
          }
        } else if (resource === 'org') {
          if (operation === 'create') {
            const name = this.getNodeParameter('orgName', i) as string;
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'POST',
                url: `${baseUrl}/orgs`,
                body: { name },
                json: true,
              },
            );
          } else if (operation === 'list') {
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'GET',
                url: `${baseUrl}/orgs`,
                json: true,
              },
            );
          } else if (operation === 'delete') {
            const orgId = this.getNodeParameter('orgId', i) as string;
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'DELETE',
                url: `${baseUrl}/orgs/${encodeURIComponent(orgId)}`,
                json: true,
              },
            );
          }
        } else if (resource === 'role') {
          const roleOrgId = this.getNodeParameter('roleOrgId', i) as string;
          if (operation === 'create') {
            const name = this.getNodeParameter('roleName', i) as string;
            const permissions = this.getNodeParameter('rolePermissions', i) as string;
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'POST',
                url: `${baseUrl}/orgs/${encodeURIComponent(roleOrgId)}/roles`,
                body: { name, permissions },
                json: true,
              },
            );
          } else if (operation === 'list') {
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'GET',
                url: `${baseUrl}/orgs/${encodeURIComponent(roleOrgId)}/roles`,
                json: true,
              },
            );
          } else if (operation === 'delete') {
            const name = this.getNodeParameter('roleName', i) as string;
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'DELETE',
                url: `${baseUrl}/orgs/${encodeURIComponent(roleOrgId)}/roles/${encodeURIComponent(name)}`,
                json: true,
              },
            );
          }
        } else if (resource === 'server') {
          // Health check doesn't use auth
          response = await this.helpers.httpRequest({
            method: 'GET',
            url: `${baseUrl}/health`,
            json: true,
          });
        }

        returnData.push({ json: response as IDataObject });
      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({
            json: { error: (error as Error).message },
          });
          continue;
        }
        // Surface plain-text error bodies (e.g. rate-limiter 429 responses)
        const err = error as Error & {
          response?: { body?: unknown; statusCode?: number };
          cause?: { response?: { body?: unknown; statusCode?: number } };
        };
        const responseBody = err?.response?.body ?? err?.cause?.response?.body;
        if (typeof responseBody === 'string' && responseBody.trim()) {
          throw new NodeApiError(this.getNode(), error as JsonObject, {
            message: responseBody.trim(),
            httpCode: String(err?.response?.statusCode ?? err?.cause?.response?.statusCode ?? ''),
          });
        }
        throw new NodeApiError(this.getNode(), error as JsonObject);
      }
    }

    return [returnData];
  }
}
