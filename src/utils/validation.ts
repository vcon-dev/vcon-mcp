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
  isValidDialogType,
  isValidEncoding,
  isValidDisposition 
} from '../types/vcon.js';

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

    // Core vCon validation
    this.validateVConVersion(vcon);
    this.validateUUID(vcon.uuid);
    this.validateDates(vcon);
    this.validateParties(vcon.parties);
    
    if (vcon.dialog) this.validateDialogs(vcon.dialog);
    if (vcon.analysis) this.validateAnalysis(vcon.analysis);
    if (vcon.attachments) this.validateAttachments(vcon.attachments);
    if (vcon.extensions) this.validateExtensions(vcon.extensions);
    if (vcon.must_support) this.validateMustSupport(vcon.must_support, vcon.extensions);

    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings
    };
  }

  private validateVConVersion(vcon: VCon): void {
    if (vcon.vcon !== '0.3.0') {
      this.errors.push(`Invalid vcon version: ${vcon.vcon}. Must be '0.3.0'`);
    }
  }

  private validateUUID(uuid: string): void {
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
      // At least one identifier should be present
      const hasIdentifier = party.tel || party.sip || party.mailto || party.name || party.uuid;
      if (!hasIdentifier) {
        this.errors.push(`Party ${index} has no identifier (tel, sip, mailto, name, or uuid)`);
      }

      // Validate party UUID if present
      if (party.uuid) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(party.uuid)) {
          this.errors.push(`Party ${index} has invalid UUID format: ${party.uuid}`);
        }
      }
    });
  }

  private validateDialogs(dialogs: Dialog[]): void {
    dialogs.forEach((dialog, index) => {
      // ✅ Validate dialog type (one of 4 valid types)
      if (!isValidDialogType(dialog.type)) {
        this.errors.push(
          `Dialog ${index} has invalid type: ${dialog.type}. ` +
          `Must be one of: recording, text, transfer, incomplete`
        );
      }

      // Validate encoding if present
      if (dialog.encoding && !isValidEncoding(dialog.encoding)) {
        this.errors.push(
          `Dialog ${index} has invalid encoding: ${dialog.encoding}. ` +
          `Must be one of: base64url, json, none`
        );
      }

      // Incomplete dialogs must have disposition
      if (dialog.type === 'incomplete' && !dialog.disposition) {
        this.errors.push(`Dialog ${index} is incomplete but has no disposition`);
      }

      // Validate disposition values
      if (dialog.disposition && !isValidDisposition(dialog.disposition)) {
        this.errors.push(
          `Dialog ${index} has invalid disposition: ${dialog.disposition}`
        );
      }

      // Transfer dialogs must have transfer fields
      if (dialog.type === 'transfer') {
        if (dialog.transferee === undefined || dialog.transferor === undefined || dialog.transfer_target === undefined) {
          this.errors.push(`Dialog ${index} is transfer type but missing transfer fields`);
        }
      }

      // Must have either (body + encoding) or (url + content_hash)
      const hasInline = dialog.body !== undefined && dialog.encoding !== undefined;
      const hasExternal = dialog.url !== undefined && dialog.content_hash !== undefined;
      
      if (!hasInline && !hasExternal) {
        this.errors.push(
          `Dialog ${index} must have either (body + encoding) or (url + content_hash)`
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
          JSON.parse(analysis.body);
        } catch (e) {
          this.errors.push(
            `Analysis ${index} has encoding='json' but body is not valid JSON`
          );
        }
      }

      // Must have either (body + encoding) or (url + content_hash)
      const hasInline = analysis.body !== undefined && analysis.encoding !== undefined;
      const hasExternal = analysis.url !== undefined && analysis.content_hash !== undefined;
      
      if (!hasInline && !hasExternal) {
        this.errors.push(
          `Analysis ${index} must have either (body + encoding) or (url + content_hash)`
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

      // Must have either (body + encoding) or (url + content_hash)
      const hasInline = attachment.body !== undefined && attachment.encoding !== undefined;
      const hasExternal = attachment.url !== undefined && attachment.content_hash !== undefined;
      
      if (!hasInline && !hasExternal) {
        this.errors.push(
          `Attachment ${index} must have either (body + encoding) or (url + content_hash)`
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

  private validateMustSupport(mustSupport: string[], extensions?: string[]): void {
    // must_support should reference extensions
    if (extensions) {
      mustSupport.forEach((ext, index) => {
        if (!extensions.includes(ext)) {
          this.warnings.push(
            `must_support[${index}] references '${ext}' which is not in extensions array`
          );
        }
      });
    } else {
      this.warnings.push('must_support is set but no extensions are defined');
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

  if (!isValidDialogType(dialog.type)) {
    errors.push(
      `Invalid dialog type: ${dialog.type}. Must be one of: recording, text, transfer, incomplete`
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

  // Validate UUID format if present
  if (party.uuid) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(party.uuid)) {
      errors.push(`Invalid UUID format: ${party.uuid}`);
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
 * Per spec Section 4.4, attachments must have either (body + encoding) or (url + content_hash)
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

  // Must have either (body + encoding) or (url + content_hash)
  const hasInline = attachment.body !== undefined && attachment.encoding !== undefined;
  const hasExternal = attachment.url !== undefined && attachment.content_hash !== undefined;
  
  if (!hasInline && !hasExternal) {
    errors.push(
      'Attachment must have either (body + encoding) or (url + content_hash)'
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

