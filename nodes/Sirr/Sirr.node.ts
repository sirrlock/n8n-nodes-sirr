import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export class Sirr implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Sirr',
    name: 'sirr',
    icon: 'file:sirr.svg',
    group: ['transform'],
    version: 2,
    subtitle: '={{["resource"] + ": " + ["operation"]}}',
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
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Secret', value: 'secret' },
          { name: 'Audit', value: 'audit' },
          { name: 'Server', value: 'server' },
        ],
        default: 'secret',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['secret'] } },
        options: [
          { name: 'Push', value: 'push', action: 'Create a secret' },
          { name: 'Get', value: 'get', action: 'Read a secret value' },
          { name: 'Inspect', value: 'inspect', action: 'Check metadata via HEAD' },
          { name: 'Patch', value: 'patch', action: 'Update a secret' },
          { name: 'Burn', value: 'burn', action: 'Delete a secret' },
          { name: 'List', value: 'list', action: 'List owned secrets' },
        ],
        default: 'push',
      },
      {
        displayName: 'Hash',
        name: 'hash',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['secret'], operation: ['get', 'inspect', 'patch', 'burn'] },
        },
        description: 'The secret hash',
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
      },
      {
        displayName: 'TTL (Seconds)',
        name: 'ttlSeconds',
        type: 'number',
        default: 3600,
        displayOptions: {
          show: { resource: ['secret'], operation: ['push', 'patch'] },
        },
      },
      {
        displayName: 'Reads',
        name: 'reads',
        type: 'number',
        default: 1,
        displayOptions: {
          show: { resource: ['secret'], operation: ['push', 'patch'] },
        },
      },
      {
        displayName: 'Prefix',
        name: 'prefix',
        type: 'string',
        default: '',
        displayOptions: {
          show: { resource: ['secret'], operation: ['push'] },
        },
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['audit'] } },
        options: [
          { name: 'Get', value: 'get', action: 'Get audit trail' },
        ],
        default: 'get',
      },
      {
        displayName: 'Hash',
        name: 'auditHash',
        type: 'string',
        default: '',
        required: true,
        displayOptions: {
          show: { resource: ['audit'], operation: ['get'] },
        },
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['server'] } },
        options: [
          { name: 'Health', value: 'health', action: 'Check health' },
        ],
        default: 'health',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];
    const credentials = await this.getCredentials('sirrApi');
    const baseUrl = (credentials.serverUrl as string).replace(/\/$/, '');

    for (let i = 0; i < items.length; i++) {
      try {
        const resource = this.getNodeParameter('resource', i) as string;
        const operation = this.getNodeParameter('operation', i) as string;
        let response: unknown;

        if (resource === 'secret') {
          if (operation === 'push') {
            const body = {
              value: this.getNodeParameter('value', i),
              ttl_seconds: this.getNodeParameter('ttlSeconds', i),
              reads: this.getNodeParameter('reads', i),
              prefix: this.getNodeParameter('prefix', i) || undefined,
            };
            response = await this.helpers.httpRequestWithAuthentication.call(this, 'sirrApi', {
              method: 'POST',
              url: `${baseUrl}/secret`,
              body,
              json: true,
            });
          } else if (operation === 'get') {
            const hash = this.getNodeParameter('hash', i) as string;
            const res = await this.helpers.httpRequestWithAuthentication.call(this, 'sirrApi', {
              method: 'GET',
              url: `${baseUrl}/secret/${encodeURIComponent(hash)}`,
              returnFullResponse: true,
            }) as any;
            if (res.statusCode === 410) response = { value: null };
            else response = { value: res.body };
          } else if (operation === 'inspect') {
            const hash = this.getNodeParameter('hash', i) as string;
            const res = await this.helpers.httpRequestWithAuthentication.call(this, 'sirrApi', {
              method: 'HEAD',
              url: `${baseUrl}/secret/${encodeURIComponent(hash)}`,
              returnFullResponse: true,
            }) as any;
            if (res.statusCode === 410) response = null;
            else {
              const h = res.headers;
              response = {
                created: h['x-sirr-created'],
                ttl_expires: h['x-sirr-ttl-expires'],
                reads_remaining: h['x-sirr-reads-remaining'],
                owned: h['x-sirr-owned'] === 'true',
              };
            }
          } else if (operation === 'patch') {
            const hash = this.getNodeParameter('hash', i) as string;
            const body = {
              ttl_seconds: this.getNodeParameter('ttlSeconds', i),
              reads: this.getNodeParameter('reads', i),
            };
            response = await this.helpers.httpRequestWithAuthentication.call(this, 'sirrApi', {
              method: 'PATCH',
              url: `${baseUrl}/secret/${encodeURIComponent(hash)}`,
              body,
              json: true,
            });
          } else if (operation === 'burn') {
            const hash = this.getNodeParameter('hash', i) as string;
            await this.helpers.httpRequestWithAuthentication.call(this, 'sirrApi', {
              method: 'DELETE',
              url: `${baseUrl}/secret/${encodeURIComponent(hash)}`,
            });
            response = { success: true };
          } else if (operation === 'list') {
            response = await this.helpers.httpRequestWithAuthentication.call(this, 'sirrApi', {
              method: 'GET',
              url: `${baseUrl}/secrets`,
              json: true,
            });
          }
        } else if (resource === 'audit') {
          const hash = this.getNodeParameter('auditHash', i) as string;
          response = await this.helpers.httpRequestWithAuthentication.call(this, 'sirrApi', {
            method: 'GET',
            url: `${baseUrl}/secret/${encodeURIComponent(hash)}/audit`,
            json: true,
          });
        } else if (resource === 'server') {
          response = await this.helpers.httpRequest({
            method: 'GET',
            url: `${baseUrl}/health`,
            json: true,
          });
        }

        returnData.push({ json: response as IDataObject });
      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({ json: { error: (error as Error).message } });
          continue;
        }
        throw new NodeApiError(this.getNode(), error as JsonObject);
      }
    }

    return [returnData];
  }
}
