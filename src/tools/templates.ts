import { randomUUID } from 'crypto';
import type { ToolCategory } from '../config/tools.js';
import { VCon } from '../types/vcon.js';
import { LAWFUL_BASIS_PURPOSE } from '../utils/lawful-basis.js';

export const createFromTemplateTool = {
  name: 'create_vcon_from_template',
  category: 'write' as ToolCategory,
  description: 'Create a new vCon from a predefined template (phone_call, chat_conversation, email_thread, video_meeting, custom).',
  inputSchema: {
    type: 'object' as const,
    properties: {
      template_name: {
        type: 'string',
        enum: ['phone_call', 'chat_conversation', 'email_thread', 'video_meeting', 'custom'],
      },
      parties: {
        type: 'array',
        items: { type: 'object' },
        description: 'Participants in the conversation',
      },
      subject: { type: 'string' },
      lawful_basis: {
        type: 'object',
        description: 'Optional lawful basis record (draft-howe-vcon-lawful-basis), attached as a lawful_basis attachment. Never defaulted: when omitted the vCon carries none and the response warns. ' +
          'Fields: lawful_basis (consent, contract, legal_obligation, vital_interests, public_task, legitimate_interests), expiration, purpose_grants, proof_mechanisms.',
        properties: {
          lawful_basis: {
            type: 'string',
            enum: ['consent', 'contract', 'legal_obligation', 'vital_interests', 'public_task', 'legitimate_interests'],
          },
          expiration: { type: ['string', 'null'] },
          purpose_grants: { type: 'array', items: { type: 'object' } },
          proof_mechanisms: { type: 'array', items: { type: 'object' } },
        },
        required: ['lawful_basis'],
      }
    },
    required: ['template_name', 'parties']
  }
};

export function buildTemplateVCon(
  template: string,
  subject: string | undefined,
  parties: any[],
  lawfulBasis?: Record<string, unknown>
): VCon {
  const now = new Date().toISOString();
  const base: VCon = {
    vcon: '0.4.0',
    uuid: randomUUID(),
    created_at: now,
    subject,
    parties,
  } as unknown as VCon;

  let vcon: VCon;
  switch (template) {
    case 'phone_call':
    case 'chat_conversation':
    case 'video_meeting':
      vcon = { ...base, dialog: [] } as VCon;
      break;
    case 'email_thread':
      vcon = { ...base, attachments: [] } as VCon;
      break;
    case 'custom':
    default:
      vcon = base;
  }

  // Only attach a lawful basis the caller supplied. Never invent one.
  if (lawfulBasis) {
    const attachment = {
      type: LAWFUL_BASIS_PURPOSE,
      purpose: LAWFUL_BASIS_PURPOSE,
      mediatype: 'application/json',
      encoding: 'json',
      body: JSON.stringify(lawfulBasis),
    };
    vcon = { ...vcon, attachments: [...((vcon.attachments as any[]) ?? []), attachment] } as VCon;
  }
  return vcon;
}


