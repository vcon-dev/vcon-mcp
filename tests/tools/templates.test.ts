/**
 * Tests for template tools
 */

import { describe, it, expect } from 'vitest';
import { createFromTemplateTool, buildTemplateVCon } from '../../src/tools/templates.js';
import { VCon } from '../../src/types/vcon.js';

describe('Templates', () => {
  describe('createFromTemplateTool', () => {
    it('should have correct tool definition', () => {
      expect(createFromTemplateTool).toHaveProperty('name', 'create_vcon_from_template');
      expect(createFromTemplateTool).toHaveProperty('description');
      expect(createFromTemplateTool).toHaveProperty('inputSchema');
    });

    it('should have valid input schema', () => {
      expect(createFromTemplateTool.inputSchema.type).toBe('object');
      expect(createFromTemplateTool.inputSchema.properties).toHaveProperty('template_name');
      expect(createFromTemplateTool.inputSchema.properties).toHaveProperty('parties');
      expect(createFromTemplateTool.inputSchema.properties).toHaveProperty('subject');
      expect(createFromTemplateTool.inputSchema.properties).toHaveProperty('metadata');
    });

    it('should have required fields', () => {
      expect(createFromTemplateTool.inputSchema.required).toContain('template_name');
      expect(createFromTemplateTool.inputSchema.required).toContain('parties');
    });

    it('should have valid template_name enum', () => {
      const templateNameProp = createFromTemplateTool.inputSchema.properties.template_name;
      expect(templateNameProp.enum).toContain('phone_call');
      expect(templateNameProp.enum).toContain('chat_conversation');
      expect(templateNameProp.enum).toContain('email_thread');
      expect(templateNameProp.enum).toContain('video_meeting');
      expect(templateNameProp.enum).toContain('custom');
    });
  });

  describe('buildTemplateVCon', () => {
    const mockParties = [
      { name: 'Alice', mailto: 'alice@example.com' },
      { name: 'Bob', tel: '+1234567890' },
    ];

    it('should build phone_call template', () => {
      const vcon = buildTemplateVCon('phone_call', 'Test Call', mockParties);

      expect(vcon.vcon).toBe('0.3.0');
      expect(vcon.uuid).toBeDefined();
      expect(vcon.created_at).toBeDefined();
      expect(vcon.subject).toBe('Test Call');
      expect(vcon.parties).toEqual(mockParties);
      expect(vcon.dialog).toBeDefined();
      expect(Array.isArray(vcon.dialog)).toBe(true);
    });

    it('should build chat_conversation template', () => {
      const vcon = buildTemplateVCon('chat_conversation', 'Test Chat', mockParties);

      expect(vcon.vcon).toBe('0.3.0');
      expect(vcon.subject).toBe('Test Chat');
      expect(vcon.parties).toEqual(mockParties);
      expect(vcon.dialog).toBeDefined();
      expect(Array.isArray(vcon.dialog)).toBe(true);
    });

    it('should build email_thread template', () => {
      const vcon = buildTemplateVCon('email_thread', 'Test Email', mockParties);

      expect(vcon.vcon).toBe('0.3.0');
      expect(vcon.subject).toBe('Test Email');
      expect(vcon.parties).toEqual(mockParties);
      expect(vcon.attachments).toBeDefined();
      expect(Array.isArray(vcon.attachments)).toBe(true);
    });

    it('should build video_meeting template', () => {
      const vcon = buildTemplateVCon('video_meeting', 'Test Meeting', mockParties);

      expect(vcon.vcon).toBe('0.3.0');
      expect(vcon.subject).toBe('Test Meeting');
      expect(vcon.parties).toEqual(mockParties);
      expect(vcon.dialog).toBeDefined();
      expect(Array.isArray(vcon.dialog)).toBe(true);
    });

    it('should build custom template', () => {
      const vcon = buildTemplateVCon('custom', 'Test Custom', mockParties);

      expect(vcon.vcon).toBe('0.3.0');
      expect(vcon.subject).toBe('Test Custom');
      expect(vcon.parties).toEqual(mockParties);
    });

    it('should handle default/unknown template as custom', () => {
      const vcon = buildTemplateVCon('unknown_template' as any, 'Test', mockParties);

      expect(vcon.vcon).toBe('0.3.0');
      expect(vcon.subject).toBe('Test');
      expect(vcon.parties).toEqual(mockParties);
    });

    it('should handle undefined subject', () => {
      const vcon = buildTemplateVCon('phone_call', undefined, mockParties);

      expect(vcon.subject).toBeUndefined();
      expect(vcon.parties).toEqual(mockParties);
    });

    it('should generate unique UUIDs', () => {
      const vcon1 = buildTemplateVCon('phone_call', 'Test 1', mockParties);
      const vcon2 = buildTemplateVCon('phone_call', 'Test 2', mockParties);

      expect(vcon1.uuid).not.toBe(vcon2.uuid);
    });

    it('should set created_at timestamp', () => {
      const before = new Date().toISOString();
      const vcon = buildTemplateVCon('phone_call', 'Test', mockParties);
      const after = new Date().toISOString();

      expect(vcon.created_at).toBeDefined();
      expect(vcon.created_at >= before).toBe(true);
      expect(vcon.created_at <= after).toBe(true);
    });
  });
});

