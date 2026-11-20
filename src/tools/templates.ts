import { randomUUID } from 'crypto';
import type { ToolCategory } from '../config/tools.js';
import { VCON_VERSION, VCon } from '../types/vcon.js';
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
      lawful_basis_party: {
        type: 'integer',
        minimum: 0,
        description: 'Party index recorded as the contributor of the lawful_basis attachment. Defaults to 0 (the first party) when lawful_basis is given without it.',
      },
      lawful_basis: {
        type: 'object',
        description: 'Optional lawful basis record (draft-howe-vcon-lawful-basis), attached as a lawful_basis attachment scoped with party plus session. Never defaulted: when omitted the vCon carries none and the response warns. ' +
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
  lawfulBasis?: Record<string, unknown>,
  lawfulBasisParty?: number
): VCon {
  const now = new Date().toISOString();
  const base: VCon = {
    vcon: VCON_VERSION,
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
    // 0.5.0 scopes a lawful basis with party plus session. The template has one Session
    // for the whole conversation (created empty when the template made none), so the
    // record covers it. The party is the caller's lawful_basis_party, else the first party.
    const sessions = vcon.sessions && vcon.sessions.length > 0 ? vcon.sessions : [{}];
    const attachment = {
      type: LAWFUL_BASIS_PURPOSE,
      purpose: LAWFUL_BASIS_PURPOSE,
      start: now,
      party: lawfulBasisParty ?? 0,
      session: sessions.map((_, i) => i),
      mediatype: 'application/json',
      encoding: 'json',
      body: JSON.stringify(lawfulBasis),
    };
    vcon = {
      ...vcon,
      sessions,
      extensions: [...new Set([...(vcon.extensions ?? []), LAWFUL_BASIS_PURPOSE])],
      attachments: [...((vcon.attachments as any[]) ?? []), attachment],
    } as VCon;
  }
  return vcon;
}


