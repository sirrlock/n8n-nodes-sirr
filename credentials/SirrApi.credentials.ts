import type {
  IAuthenticateGeneric,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class SirrApi implements ICredentialType {
  name = 'sirrApi';
  displayName = 'Sirr API';
  documentationUrl = 'https://sirrlock.com/docs/n8n';

  properties: INodeProperties[] = [
    {
      displayName: 'Server URL',
      name: 'serverUrl',
      type: 'string',
      default: 'https://sirrlock.com',
      placeholder: 'https://sirr.example.com',
      description: 'Base URL of your Sirr server (no trailing slash)',
    },
    {
      displayName: 'API Token',
      name: 'apiToken',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      description: 'Bearer token — master key or scoped API key',
    },
    {
      displayName: 'Organization ID',
      name: 'org',
      type: 'string',
      default: '',
      description: 'Optional org ID for multi-tenant mode. Leave empty for public bucket.',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.apiToken}}',
      },
    },
  };
}
