/**
 * vCon Validation Utilities
 * 
 * Validates vCon objects against IETF spec requirements
 * ✅ Enforces all 7 critical corrections
 */

import {
  VCon,
  Analysis,
  Dialog,
  Party,
  isEmptyDialog,
  isLegacyDialogType,
  isValidDialogType,
  isValidEncoding
} from '../types/vcon.js';
import { validateVConDocument } from './vcon-validation.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class VConValidator {
  private errors: string[] = [];
  private warnings: string[] = [];

  /**
   * Validate a complete vCon object
   */
  validate(vcon: VCon): ValidationResult {
    this.errors = [];
    this.warnings = [];

    // Core vCon validation (vcon version field is deprecated - accept any value or missing)
    this.validateUUID(vcon.uuid);
    this.validateDates(vcon);
    this.validateParties(vcon.parties);
    
    // 0.5.0 structure: Sessions, Events, references, Attachment scope, redacted_from/amended_from
    const doc = validateVConDocument(vcon as unknown as Record<string, any>);
    this.errors.push(...doc.errors);
    this.warnings.push(...doc.warnings);

    if (vcon.dialog) this.validateDialogs(vcon.dialog);
    if (vcon.analysis) this.validateAnalysis(vcon.analysis);
    if (vcon.attachments) this.validateAttachments(vcon.attachments);
    if (vcon.extensions) this.validateExtensions(vcon.extensions);
    if (vcon.critical) this.validateCritical(vcon.critical, vcon.extensions);

    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings
    };
  }

  private validateUUID(uuid: string | undefined): void {
    if (typeof uuid !== 'string') {
      this.errors.push(`Invalid UUID format: ${uuid}`);
      return;
    }
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(uuid)) {
      this.errors.push(`Invalid UUID format: ${uuid}`);
    }
  }

  private validateDates(vcon: VCon): void {
    try {
      new Date(vcon.created_at);
    } catch (e) {
      this.errors.push(`Invalid created_at date: ${vcon.created_at}`);
    }

    if (vcon.updated_at) {
      try {
        new Date(vcon.updated_at);
      } catch (e) {
        this.errors.push(`Invalid updated_at date: ${vcon.updated_at}`);
      }
    }
  }

  private validateParties(parties: Party[]): void {
    if (parties.length === 0) {
      this.errors.push('vCon must have at least one party');
      return;
    }

    parties.forEach((party, index) => {
      // An empty Party Object is valid: it stands for an unknown party (4.3.9, 4.2.4)
      if (party && typeof party === 'object' && Object.keys(party).length === 0) return;

      // At least one identifier should be present
      const hasIdentifier = party.tel || party.sip || party.mailto || party.name || party.uuid;
      if (!hasIdentifier) {
        this.errors.push(`Party ${index} has no identifier (tel, sip, mailto, name, or uuid)`);
      }

      // Validate party UUID if present (warning only - accepts any string identifier)
      if (party.uuid) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(party.uuid)) {
          this.warnings.push(`Party ${index} has non-standard UUID format: ${party.uuid}`);
        }
      }
    });
  }

  private validateDialogs(dialogs: Dialog[]): void {
    dialogs.forEach((dialog, index) => {
      // An empty Dialog Object {} holds an index position (Section 4.5.1)
      if (isEmptyDialog(dialog)) return;

      // Dialog type is checked by validateVConDocument (invalid types are errors;
      // audio/video are read-only legacy values and only warn).

      // Validate encoding if present
      if (dialog.encoding && !isValidEncoding(dialog.encoding)) {
        this.errors.push(
          `Dialog ${index} has invalid encoding: ${dialog.encoding}. ` +
          `Must be one of: base64url, json, none`
        );
      }

      // Incomplete dialogs must have disposition (any string is accepted)
      if (dialog.type === 'incomplete' && !dialog.disposition) {
        this.errors.push(`Dialog ${index} is incomplete but has no disposition`);
      }

      if (dialog.disposition != null && typeof dialog.disposition !== 'string') {
        this.errors.push(`Dialog ${index} disposition must be a string`);
      }

      // Content validation is relaxed - dialogs may have missing content in some cases
      // (e.g., incomplete recordings, external references not yet available).
      // A url without a content_hash is allowed (vcon-lib 1.0.6, core issue #40).
      const hasInline = dialog.body !== undefined && dialog.encoding !== undefined;
      const hasExternal = dialog.url !== undefined;
      
      if (!hasInline && !hasExternal && dialog.type !== 'incomplete') {
        // Only warn, don't error - some dialogs may legitimately have no content
        this.warnings.push(
          `Dialog ${index} has no content (body + encoding) or external reference (url)`
        );
      }

      // Validate date formats
      if (dialog.start) {
        try {
          new Date(dialog.start);
        } catch (e) {
          this.errors.push(`Dialog ${index} has invalid start date: ${dialog.start}`);
        }
      }
    });
  }

  private validateAnalysis(analyses: Analysis[]): void {
    analyses.forEach((analysis, index) => {
      // ✅ CRITICAL: vendor is required per spec Section 4.5.5
      if (!analysis.vendor) {
        this.errors.push(`Analysis ${index} missing REQUIRED field: vendor (Section 4.5.5)`);
      }

      // Validate encoding if present
      if (analysis.encoding && !isValidEncoding(analysis.encoding)) {
        this.errors.push(
          `Analysis ${index} has invalid encoding: ${analysis.encoding}. ` +
          `Must be one of: base64url, json, none`
        );
      }

      // If body and encoding are present, validate they match
      if (analysis.body && analysis.encoding === 'json') {
        try {
          // body may already be a parsed object or a JSON string
          if (typeof analysis.body === 'string') {
            JSON.parse(analysis.body);
          }
          // If it's already an object, it's valid JSON
        } catch (e) {
          this.errors.push(
            `Analysis ${index} has encoding='json' but body is not valid JSON`
          );
        }
      }

      // Must have either (body + encoding) or url; a url without a content_hash is
      // allowed (vcon-lib 1.0.6, core issue #40)
      const hasInline = analysis.body !== undefined && analysis.encoding !== undefined;
      const hasExternal = analysis.url !== undefined;
      
      if (!hasInline && !hasExternal) {
        this.errors.push(
          `Analysis ${index} must have either (body + encoding) or url`
        );
      }

      // ✅ Validate that 'schema' field is used (not 'schema_version')
      // This is a TypeScript compile-time check, but we add a runtime warning
      if ((analysis as any).schema_version !== undefined) {
        this.errors.push(
          `Analysis ${index} uses 'schema_version' field which is INCORRECT. ` +
          `Per spec Section 4.5.7, the correct field name is 'schema'`
        );
      }
    });
  }

  private validateAttachments(attachments: any[]): void {
    attachments.forEach((attachment, index) => {
      // Validate encoding if present
      if (attachment.encoding && !isValidEncoding(attachment.encoding)) {
        this.errors.push(
          `Attachment ${index} has invalid encoding: ${attachment.encoding}`
        );
      }

      // Must have either (body + encoding) or url; a url without a content_hash is
      // allowed (vcon-lib 1.0.6, core issue #40)
      const hasInline = attachment.body !== undefined && attachment.encoding !== undefined;
      const hasExternal = attachment.url !== undefined;
      
      if (!hasInline && !hasExternal) {
        this.errors.push(
          `Attachment ${index} must have either (body + encoding) or url`
        );
      }
    });
  }

  private validateExtensions(extensions: string[]): void {
    // Extensions should be URIs or identifiers
    extensions.forEach((ext, index) => {
      if (typeof ext !== 'string' || ext.length === 0) {
        this.errors.push(`Extension ${index} must be a non-empty string`);
      }
    });
  }

  private validateCritical(critical: string[], extensions?: string[]): void {
    // critical should reference extensions
    if (extensions) {
      critical.forEach((ext, index) => {
        if (!extensions.includes(ext)) {
          this.warnings.push(
            `critical[${index}] references '${ext}' which is not in extensions array`
          );
        }
      });
    } else {
      this.warnings.push('critical is set but no extensions are defined');
    }
  }
}

/**
 * Convenience function to validate a vCon
 */
export function validateVCon(vcon: VCon): ValidationResult {
  const validator = new VConValidator();
  return validator.validate(vcon);
}

/**
 * Validate that an Analysis object has all required fields
 * ✅ Enforces vendor requirement and correct field names
 */
export function validateAnalysis(analysis: Analysis): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ✅ CRITICAL: vendor is required
  if (!analysis.vendor) {
    errors.push('Analysis missing REQUIRED field: vendor (Section 4.5.5)');
  }

  if (!analysis.type) {
    errors.push('Analysis missing required field: type');
  }

  // Check for incorrect field name
  if ((analysis as any).schema_version !== undefined) {
    errors.push(
      'Analysis uses incorrect field name "schema_version". ' +
      'Per spec Section 4.5.7, the correct field name is "schema"'
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate UUID format
 * Returns true if UUID matches standard format, false otherwise
 */
export function isValidUUID(uuid: string | undefined | null): boolean {
  if (!uuid) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * Validate UUID format and return validation result
 * Use this in tool handlers for consistent validation
 */
export function validateUUID(uuid: string | undefined | null, paramName: string = 'uuid'): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  if (!uuid) {
    errors.push(`${paramName} is required`);
  } else if (!isValidUUID(uuid)) {
    errors.push(`Invalid ${paramName} format: "${uuid}". Expected UUID format (e.g., "550e8400-e29b-41d4-a716-446655440000")`);
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate Dialog type
 */
export function validateDialog(dialog: Dialog): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (isEmptyDialog(dialog)) {
    return { valid: true, errors, warnings };
  }

  if (!dialog.type) {
    errors.push('Dialog is missing required field: type (unless the Dialog is empty)');
  } else if (isLegacyDialogType(dialog.type)) {
    warnings.push(`Dialog type '${dialog.type}' is not defined in core-05; it is read as 'recording' and never written`);
  } else if (!isValidDialogType(dialog.type)) {
    errors.push(
      `Invalid dialog type: ${dialog.type}. Must be one of: recording, text, incomplete`
    );
  }

  if (dialog.encoding && !isValidEncoding(dialog.encoding)) {
    errors.push(`Invalid encoding: ${dialog.encoding}`);
  }

  if (dialog.type === 'incomplete' && !dialog.disposition) {
    errors.push('Incomplete dialog must have a disposition');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate Party object
 */
export function validateParty(party: Party): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // At least one identifier required
  const hasIdentifier = party.tel || party.sip || party.mailto || party.name || party.uuid;
  if (!hasIdentifier) {
    errors.push('Party must have at least one identifier (tel, sip, mailto, name, or uuid)');
  }

  // Validate UUID format if present (warning only - accepts any string identifier)
  if (party.uuid) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(party.uuid)) {
      warnings.push(`Party has non-standard UUID format: ${party.uuid}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate Attachment object
 * Per spec Section 4.6, attachments must have either (body + encoding) or url (a url without
 * a content_hash is allowed, vcon-lib 1.0.6)
 * and a scope: at least one of dialog or session. Index range is checked against the vCon
 * by validateVCon; a lone attachment is checked for shape only.
 */
export function validateAttachment(attachment: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate encoding if present
  if (attachment.encoding && !isValidEncoding(attachment.encoding)) {
    errors.push(
      `Invalid encoding: ${attachment.encoding}. ` +
      `Must be one of: base64url, json, none`
    );
  }

  // Must have either (body + encoding) or url
  const hasInline = attachment.body !== undefined && attachment.encoding !== undefined;
  const hasExternal = attachment.url !== undefined;
  
  if (!hasInline && !hasExternal) {
    errors.push(
      'Attachment must have either (body + encoding) or url'
    );
  }

  if (attachment.party === undefined) {
    errors.push('Attachment is missing required field: party (Section 4.6.3)');
  }
  if (attachment.dialog === undefined && attachment.session === undefined) {
    errors.push('Attachment must have at least one of dialog or session (Sections 4.6.4, 4.6.5)');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

