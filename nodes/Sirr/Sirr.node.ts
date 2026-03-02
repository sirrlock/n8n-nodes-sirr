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
          { name: 'API Key', value: 'apiKey' },
          { name: 'Principal', value: 'principal' },
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
          { name: 'Push', value: 'push', action: 'Push a secret' },
          { name: 'List', value: 'list', action: 'List all secrets' },
          { name: 'Delete', value: 'delete', action: 'Delete a secret' },
          { name: 'Prune', value: 'prune', action: 'Prune expired secrets' },
        ],
        default: 'get',
      },
      {
        displayName: 'Key',
        name: 'key',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['secret'], operation: ['get', 'delete'] },
        },
        description: 'The secret key name',
      },
      {
        displayName: 'Key',
        name: 'pushKey',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['secret'], operation: ['push'] },
        },
        description: 'The key to store the secret under',
      },
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
        description: 'The secret value',
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
        description: 'Maximum number of reads (0 = unlimited)',
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

      /* ── API Key operations ───────────────────── */
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['apiKey'] } },
        options: [
          { name: 'Create', value: 'create', action: 'Create an API key' },
          { name: 'List', value: 'list', action: 'List API keys' },
          { name: 'Delete', value: 'delete', action: 'Delete an API key' },
        ],
        default: 'list',
      },
      {
        displayName: 'Label',
        name: 'keyLabel',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['apiKey'], operation: ['create'] },
        },
        description: 'Human-readable label for the API key',
      },
      {
        displayName: 'Permissions',
        name: 'permissions',
        type: 'multiOptions',
        options: [
          { name: 'Read', value: 'read' },
          { name: 'Write', value: 'write' },
          { name: 'Delete', value: 'delete' },
          { name: 'Admin', value: 'admin' },
        ],
        default: ['read'],
        displayOptions: {
          show: { resource: ['apiKey'], operation: ['create'] },
        },
        description: 'Permissions to grant the API key',
      },
      {
        displayName: 'API Key ID',
        name: 'apiKeyId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['apiKey'], operation: ['delete'] },
        },
        description: 'The ID of the API key to delete',
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
          { name: 'Update Me', value: 'updateMe', action: 'Update current principal' },
          { name: 'Create Key', value: 'createKey', action: 'Create a personal API key' },
          { name: 'Delete Key', value: 'deleteKey', action: 'Delete a personal API key' },
        ],
        default: 'me',
      },
      {
        displayName: 'Display Name',
        name: 'principalDisplayName',
        type: 'string',
        default: '',
        displayOptions: {
          show: { resource: ['principal'], operation: ['updateMe'] },
        },
        description: 'New display name for the principal',
      },
      {
        displayName: 'Label',
        name: 'principalKeyLabel',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['principal'], operation: ['createKey'] },
        },
        description: 'Human-readable label for the personal API key',
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
          } else if (operation === 'push') {
            const key = this.getNodeParameter('pushKey', i) as string;
            const value = this.getNodeParameter('value', i) as string;
            const ttl = this.getNodeParameter('ttlSeconds', i) as number;
            const maxReads = this.getNodeParameter('maxReads', i) as number;
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'POST',
                url: `${baseUrl}${buildPath(org, '/secrets')}`,
                body: {
                  key,
                  value,
                  ttl_seconds: ttl || null,
                  max_reads: maxReads || null,
                },
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
          const actionFilter = this.getNodeParameter('actionFilter', i) as string;
          const limit = this.getNodeParameter('limit', i) as number;
          const qs: Record<string, string | number> = {};
          if (since) qs.since = since;
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
        } else if (resource === 'apiKey') {
          if (operation === 'create') {
            const label = this.getNodeParameter('keyLabel', i) as string;
            const permissions = this.getNodeParameter('permissions', i) as string[];
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'POST',
                url: `${baseUrl}/keys`,
                body: { label, permissions },
                json: true,
              },
            );
          } else if (operation === 'list') {
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'GET',
                url: `${baseUrl}/keys`,
                json: true,
              },
            );
          } else if (operation === 'delete') {
            const id = this.getNodeParameter('apiKeyId', i) as string;
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'DELETE',
                url: `${baseUrl}/keys/${encodeURIComponent(id)}`,
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
            const displayName = this.getNodeParameter('principalDisplayName', i) as string;
            const body: IDataObject = {};
            if (displayName) body.display_name = displayName;
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'PATCH',
                url: `${baseUrl}/me`,
                body,
                json: true,
              },
            );
          } else if (operation === 'createKey') {
            const label = this.getNodeParameter('principalKeyLabel', i) as string;
            response = await this.helpers.httpRequestWithAuthentication.call(
              this,
              'sirrApi',
              {
                method: 'POST',
                url: `${baseUrl}/me/keys`,
                body: { label },
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
        throw new NodeApiError(this.getNode(), error as JsonObject);
      }
    }

    return [returnData];
  }
}
