/**
 * Schema and Example Tool Handlers
 */

import crypto from 'crypto';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BaseToolHandler, ToolHandlerContext, ToolResponse } from './base.js';

/**
 * Handler for get_schema tool
 */
export class GetSchemaHandler extends BaseToolHandler {
  readonly toolName = 'get_schema';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const format = (args?.format as string | undefined) ?? 'json_schema';
    
    if (format === 'json_schema') {
      return this.createTextResponse({
        success: true,
        note: 'JSON Schema export requires zod-to-json-schema. Add dependency and implement conversion.',
      });
    } else if (format === 'typescript') {
      return {
        content: [{
          type: 'text',
          text: 'See src/types/vcon.ts for TypeScript interfaces.'
        }]
      };
    } else {
      throw new McpError(ErrorCode.InvalidParams, `Unsupported schema format: ${format}`);
    }
  }
}

/**
 * Handler for get_examples tool
 */
export class GetExamplesHandler extends BaseToolHandler {
  readonly toolName = 'get_examples';

  protected async execute(args: any, context: ToolHandlerContext): Promise<ToolResponse> {
    const exampleType = args?.example_type as string;
    const format = (args?.format as string | undefined) ?? 'json';
    
    const examples: Record<string, any> = {
      minimal: { 
        vcon: '0.3.0', 
        uuid: crypto.randomUUID(), 
        created_at: new Date().toISOString(), 
        parties: [{ name: 'Agent' }] 
      },
      phone_call: { 
        vcon: '0.3.0', 
        uuid: crypto.randomUUID(), 
        created_at: new Date().toISOString(), 
        subject: 'Phone Call', 
        parties: [{ name: 'Caller' }, { name: 'Agent' }], 
        dialog: [] 
      },
      chat: { 
        vcon: '0.3.0', 
        uuid: crypto.randomUUID(), 
        created_at: new Date().toISOString(), 
        subject: 'Chat', 
        parties: [{ name: 'User' }, { name: 'Support' }], 
        dialog: [] 
      },
      email: { 
        vcon: '0.3.0', 
        uuid: crypto.randomUUID(), 
        created_at: new Date().toISOString(), 
        subject: 'Email Thread', 
        parties: [{ mailto: 'a@example.com' }, { mailto: 'b@example.com' }], 
        attachments: [] 
      },
      video: { 
        vcon: '0.3.0', 
        uuid: crypto.randomUUID(), 
        created_at: new Date().toISOString(), 
        subject: 'Video Meeting', 
        parties: [{ name: 'Host' }], 
        dialog: [] 
      },
      full_featured: {
        vcon: '0.3.0', 
        uuid: crypto.randomUUID(), 
        created_at: new Date().toISOString(), 
        subject: 'Full Example',
        parties: [{ name: 'Alice' }, { name: 'Bob' }], 
        dialog: [], 
        analysis: [], 
        attachments: []
      }
    };
    
    const data = examples[exampleType];
    if (!data) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown example_type: ${exampleType}`);
    }
    
    if (format === 'json') {
      return this.createTextResponse(data);
    } else if (format === 'yaml') {
      const yaml = `vcon: ${data.vcon}\nuuid: ${data.uuid}\ncreated_at: ${data.created_at}`;
      return {
        content: [{ type: 'text', text: yaml }]
      };
    } else {
      throw new McpError(ErrorCode.InvalidParams, `Unsupported format: ${format}`);
    }
  }
}

