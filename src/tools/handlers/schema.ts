/**
 * Schema and Example Tool Handlers
 */

import { createHash, randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BaseToolHandler, ToolHandlerContext, ToolResponse } from './base.js';
import {
  PartySchema,
  DialogSchema,
  AnalysisSchema,
  AttachmentSchema,
} from '../vcon-crud.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Example content_hash in the spec format `sha512-<base64url, no padding>`.
 * The example URLs are not real files, so the digest is of a fixed label, not of content.
 */
const exampleHash = (label: string): string =>
  `sha512-${createHash('sha512').update(`vcon-mcp example: ${label}`).digest('base64url')}`;

const VConJsonSchema = z.object({
  vcon: z.string().default('0.4.0').describe('Spec version (current: 0.4.0)'),
  uuid: z.string().uuid().describe('Unique identifier for the vCon'),
  created_at: z.string().describe('ISO 8601 datetime when the vCon was created'),
  updated_at: z.string().optional(),
  subject: z.string().optional(),
  parties: z.array(PartySchema).min(1),
  dialog: z.array(DialogSchema).optional(),
  analysis: z.array(AnalysisSchema).optional(),
  attachments: z.array(AttachmentSchema).optional(),
  extensions: z.array(z.string()).optional(),
  critical: z.array(z.string())
    .optional()
    .describe('Extensions that MUST be supported (renamed from must_support in 0.4.0)'),
  amended: z
    .object({
      uuid: z.string().optional(),
      url: z.string().optional(),
      content_hash: z.union([z.string(), z.array(z.string())]).optional(),
    })
    .optional()
    .describe('Amended reference (renamed from appended in 0.4.0)'),
  redacted: z
    .object({
      uuid: z.string().optional(),
      type: z.string().optional(),
      url: z.string().optional(),
      content_hash: z.union([z.string(), z.array(z.string())]).optional(),
    })
    .optional(),
  group: z
    .array(
      z.object({
        uuid: z.string().optional(),
        body: z.string().optional(),
        encoding: z.literal('json').optional(),
        url: z.string().optional(),
        content_hash: z.union([z.string(), z.array(z.string())]).optional(),
      }),
    )
    .optional(),
});

async function loadTypesFile(): Promise<string> {
  const candidates = [
    resolve(__dirname, '../../types/vcon.ts'),
    resolve(__dirname, '../../types/vcon.d.ts'),
    resolve(__dirname, '../../../src/types/vcon.ts'),
    resolve(process.cwd(), 'src/types/vcon.ts'),
    resolve(process.cwd(), 'dist/types/vcon.d.ts'),
  ];
  for (const path of candidates) {
    try {
      return await readFile(path, 'utf-8');
    } catch {
      // try next candidate
    }
  }
  throw new Error('Could not locate vcon types file');
}

/**
 * Handler for get_schema tool
 */
export class GetSchemaHandler extends BaseToolHandler {
  readonly toolName = 'get_schema';

  protected async execute(args: any, _context: ToolHandlerContext): Promise<ToolResponse> {
    const format = (args?.format as string | undefined) ?? 'json_schema';

    if (format === 'json_schema') {
      const schema = zodToJsonSchema(VConJsonSchema, {
        name: 'VCon',
        $refStrategy: 'root',
      });
      return this.createTextResponse(schema);
    }

    if (format === 'typescript') {
      const source = await loadTypesFile();
      return {
        content: [{ type: 'text', text: source }],
      };
    }

    throw new McpError(ErrorCode.InvalidParams, `Unsupported schema format: ${format}`);
  }
}

/**
 * Handler for get_examples tool
 */
export class GetExamplesHandler extends BaseToolHandler {
  readonly toolName = 'get_examples';

  protected async execute(args: any, _context: ToolHandlerContext): Promise<ToolResponse> {
    const exampleType = args?.example_type as string;
    const format = (args?.format as string | undefined) ?? 'json';

    const now = new Date().toISOString();
    const mkUuid = () => randomUUID();

    const examples: Record<string, any> = {
      minimal: {
        vcon: '0.4.0',
        uuid: mkUuid(),
        created_at: now,
        parties: [{ name: 'Agent' }],
      },
      phone_call: {
        vcon: '0.4.0',
        uuid: mkUuid(),
        created_at: now,
        subject: 'Customer support call',
        parties: [
          { name: 'Jane Customer', tel: '+15551234567' },
          { name: 'Bob Agent', mailto: 'bob@example.com' },
        ],
        dialog: [
          {
            type: 'recording',
            start: now,
            duration: 327.5,
            parties: [0, 1],
            mediatype: 'audio/mpeg',
            filename: 'call-recording.mp3',
            url: 'https://storage.example.com/recordings/call-recording.mp3',
            content_hash: exampleHash('call-recording'),
            originator: 0,
          },
        ],
        analysis: [
          {
            type: 'transcript',
            dialog: 0,
            vendor: 'Deepgram',
            product: 'Nova-2',
            schema: 'deepgram-transcript-v1',
            body: JSON.stringify({
              transcript: 'Hello, I need help with my bill... Sure, I can help with that.',
              confidence: 0.94,
            }),
            encoding: 'json',
            mediatype: 'application/json',
          },
          {
            type: 'summary',
            dialog: 0,
            vendor: 'OpenAI',
            product: 'GPT-4o',
            schema: 'summary-v1',
            body: 'Customer called about billing question; agent resolved on first call.',
            encoding: 'none',
          },
          {
            type: 'sentiment',
            dialog: 0,
            vendor: 'OpenAI',
            product: 'GPT-4o',
            schema: 'sentiment-v1',
            body: JSON.stringify({ sentiment: 'positive', score: 0.82 }),
            encoding: 'json',
          },
        ],
        attachments: [
          {
            purpose: 'tags',
            encoding: 'json',
            body: '["department:support","priority:normal","disposition:resolved"]',
          },
        ],
      },
      chat: {
        vcon: '0.4.0',
        uuid: mkUuid(),
        created_at: now,
        subject: 'Sales chat',
        parties: [
          { name: 'User', mailto: 'user@example.com' },
          { name: 'Support Bot' },
        ],
        dialog: [
          {
            type: 'text',
            start: now,
            parties: [0],
            body: 'Hi, do you offer enterprise pricing?',
            encoding: 'none',
            mediatype: 'text/plain',
          },
          {
            type: 'text',
            start: now,
            parties: [1],
            body: 'Yes! Volume discounts start at 50 seats.',
            encoding: 'none',
            mediatype: 'text/plain',
          },
        ],
      },
      email: {
        vcon: '0.4.0',
        uuid: mkUuid(),
        created_at: now,
        subject: 'Contract review',
        parties: [
          { name: 'Alice', mailto: 'alice@example.com' },
          { name: 'Bob', mailto: 'bob@example.com' },
        ],
        dialog: [
          {
            type: 'text',
            start: now,
            parties: [0],
            mediatype: 'message/rfc822',
            message_id: '<msg-1@example.com>',
            body: 'Please review the attached contract by Friday.',
            encoding: 'none',
          },
        ],
        attachments: [
          {
            purpose: 'contract',
            party: 0,
            dialog: 0,
            mediatype: 'application/pdf',
            filename: 'contract.pdf',
            url: 'https://storage.example.com/contracts/contract.pdf',
            content_hash: exampleHash('contract'),
          },
        ],
      },
      video: {
        vcon: '0.4.0',
        uuid: mkUuid(),
        created_at: now,
        subject: 'Quarterly review',
        parties: [
          { name: 'Host', mailto: 'host@example.com' },
          { name: 'Attendee 1' },
          { name: 'Attendee 2' },
        ],
        dialog: [
          {
            type: 'recording',
            start: now,
            duration: 1820,
            parties: [0, 1, 2],
            mediatype: 'video/mp4',
            filename: 'meeting.mp4',
            url: 'https://storage.example.com/meetings/meeting.mp4',
            content_hash: exampleHash('meeting-video'),
          },
        ],
        analysis: [
          {
            type: 'transcript',
            dialog: 0,
            vendor: 'OpenAI',
            product: 'Whisper',
            schema: 'whisper-v1',
            body: JSON.stringify({ transcript: '... meeting transcript ...' }),
            encoding: 'json',
          },
        ],
      },
      full_featured: {
        vcon: '0.4.0',
        uuid: mkUuid(),
        created_at: now,
        subject: 'Full-featured example',
        extensions: ['tags', 'lawful_basis'],
        parties: [
          { name: 'Alice', tel: '+15551112222', mailto: 'alice@example.com' },
          { name: 'Bob', tel: '+15553334444', mailto: 'bob@example.com' },
        ],
        dialog: [
          {
            type: 'recording',
            start: now,
            duration: 240,
            parties: [0, 1],
            mediatype: 'audio/mpeg',
            url: 'https://storage.example.com/call.mp3',
            content_hash: exampleHash('call-audio'),
          },
          {
            type: 'text',
            start: now,
            parties: [0],
            body: 'Follow-up note after the call.',
            encoding: 'none',
          },
        ],
        analysis: [
          {
            type: 'transcript',
            dialog: 0,
            vendor: 'Deepgram',
            product: 'Nova-2',
            body: JSON.stringify({ transcript: '... full transcript ...' }),
            encoding: 'json',
          },
          {
            type: 'summary',
            dialog: 0,
            vendor: 'OpenAI',
            product: 'GPT-4o',
            body: 'Short summary of the conversation.',
            encoding: 'none',
          },
        ],
        attachments: [
          {
            purpose: 'tags',
            encoding: 'json',
            body: '["department:sales","priority:high","sentiment:positive"]',
          },
          {
            purpose: 'followup',
            party: 0,
            mediatype: 'application/pdf',
            filename: 'followup.pdf',
            url: 'https://storage.example.com/followup.pdf',
            content_hash: exampleHash('followup-pdf'),
          },
          // Synthetic example data only. Never copy this as a real consent or basis record.
          {
            purpose: 'lawful_basis',
            start: now,
            party: 0,
            dialog: 0,
            mediatype: 'application/json',
            encoding: 'json',
            body: {
              lawful_basis: 'legitimate_interests',
              expiration: null,
              purpose_grants: [
                { purpose: 'recording', granted: true, granted_at: now },
              ],
              proof_mechanisms: [
                {
                  mechanism_type: 'external_system',
                  description: 'Example data generated by vcon-mcp get_examples',
                },
              ],
            },
          },
        ],
      },
    };

    const data = examples[exampleType];
    if (!data) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown example_type: ${exampleType}`);
    }

    if (format === 'json') {
      return this.createTextResponse(data);
    }

    if (format === 'yaml') {
      return {
        content: [{ type: 'text', text: toYaml(data) }],
      };
    }

    throw new McpError(ErrorCode.InvalidParams, `Unsupported format: ${format}`);
  }
}

function toYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') {
    return /[:#\n"'{}\[\],&*!|>%@`]/.test(value) || value === ''
      ? JSON.stringify(value)
      : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value
      .map((item) => {
        const rendered = toYaml(item, indent + 1);
        if (typeof item === 'object' && item !== null) {
          return `${pad}-\n${rendered.replace(/^/gm, '  ')}`;
        }
        return `${pad}- ${rendered}`;
      })
      .join('\n');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return entries
      .map(([key, val]) => {
        if (val === null || val === undefined) return `${pad}${key}: null`;
        if (Array.isArray(val) || (typeof val === 'object' && val !== null)) {
          return `${pad}${key}:\n${toYaml(val, indent + 1)}`;
        }
        return `${pad}${key}: ${toYaml(val, indent)}`;
      })
      .join('\n');
  }
  return String(value);
}
