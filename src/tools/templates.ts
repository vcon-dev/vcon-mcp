import { VCon } from '../types/vcon.js';

export const createFromTemplateTool = {
  name: 'create_vcon_from_template',
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
      metadata: { type: 'object' }
    },
    required: ['template_name', 'parties']
  }
};

export function buildTemplateVCon(template: string, subject: string | undefined, parties: any[]): VCon {
  const now = new Date().toISOString();
  const base: VCon = {
    vcon: '0.3.0',
    uuid: crypto.randomUUID(),
    created_at: now,
    subject,
    parties,
  } as unknown as VCon;

  switch (template) {
    case 'phone_call':
      return { ...base, dialog: [] } as VCon;
    case 'chat_conversation':
      return { ...base, dialog: [] } as VCon;
    case 'email_thread':
      return { ...base, attachments: [] } as VCon;
    case 'video_meeting':
      return { ...base, dialog: [] } as VCon;
    case 'custom':
    default:
      return base;
  }
}


