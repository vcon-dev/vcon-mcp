import type { ToolCategory } from '../config/tools.js';

export const getSchemaTool = {
  name: 'get_schema',
  category: 'schema' as ToolCategory,
  description: 'Get vCon schema definition in the requested format (json_schema or typescript).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      version: { type: 'string', default: 'latest' },
      format: { type: 'string', enum: ['json_schema', 'typescript'], default: 'json_schema' }
    }
  }
};

export const getExamplesTool = {
  name: 'get_examples',
  category: 'schema' as ToolCategory,
  description: 'Get example vCons (minimal, phone_call, chat, email, video, full_featured) as JSON or YAML.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      example_type: { type: 'string', enum: ['minimal', 'phone_call', 'chat', 'email', 'video', 'full_featured'] },
      format: { type: 'string', enum: ['json', 'yaml'], default: 'json' }
    },
    required: ['example_type']
  }
};


