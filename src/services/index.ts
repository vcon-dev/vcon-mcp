/**
 * Services Module
 * 
 * Exports service layer components for vCon operations
 */

export {
  VConService,
  VConValidationError,
  VConNotFoundError,
} from './vcon-service.js';

export type {
  VConServiceContext,
  CreateVConOptions,
  CreateVConResult,
  BatchCreateResult,
  BatchCreateVConsResult,
  GetVConOptions,
  DeleteVConOptions,
} from './vcon-service.js';

