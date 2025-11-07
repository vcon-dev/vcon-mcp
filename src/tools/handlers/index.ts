/**
 * Tool Handler Registry and Exports
 * 
 * Registers all core tool handlers and provides the registry instance
 */

import { ToolHandlerRegistry } from './registry.js';

// Schema handlers
import { GetSchemaHandler, GetExamplesHandler } from './schema.js';

// vCon CRUD handlers
import {
  CreateVConHandler,
  CreateVConFromTemplateHandler,
  GetVConHandler,
  UpdateVConHandler,
  DeleteVConHandler,
  AddAnalysisHandler,
  AddDialogHandler,
  AddAttachmentHandler,
} from './vcon-crud.js';

// Search handlers
import {
  SearchVConsHandler,
  SearchVConsContentHandler,
  SearchVConsSemanticHandler,
  SearchVConsHybridHandler,
} from './search.js';

// Tag handlers
import {
  ManageTagHandler,
  GetTagsHandler,
  RemoveAllTagsHandler,
  SearchByTagsHandler,
  GetUniqueTagsHandler,
} from './tags.js';

// Database handlers
import {
  GetDatabaseShapeHandler,
  GetDatabaseStatsHandler,
  AnalyzeQueryHandler,
} from './database.js';

// Database analytics handlers
import {
  GetDatabaseAnalyticsHandler,
  GetMonthlyGrowthAnalyticsHandler,
  GetAttachmentAnalyticsHandler,
  GetTagAnalyticsHandler,
  GetContentAnalyticsHandler,
  GetDatabaseHealthMetricsHandler,
} from './database-analytics.js';

// Database size handlers
import {
  GetDatabaseSizeInfoHandler,
  GetSmartSearchLimitsHandler,
} from './database-size.js';

/**
 * Create and register all core tool handlers
 */
export function createHandlerRegistry(): ToolHandlerRegistry {
  const registry = new ToolHandlerRegistry();

  // Register schema handlers
  registry.register(new GetSchemaHandler());
  registry.register(new GetExamplesHandler());

  // Register vCon CRUD handlers
  registry.register(new CreateVConHandler());
  registry.register(new CreateVConFromTemplateHandler());
  registry.register(new GetVConHandler());
  registry.register(new UpdateVConHandler());
  registry.register(new DeleteVConHandler());
  registry.register(new AddAnalysisHandler());
  registry.register(new AddDialogHandler());
  registry.register(new AddAttachmentHandler());

  // Register search handlers
  registry.register(new SearchVConsHandler());
  registry.register(new SearchVConsContentHandler());
  registry.register(new SearchVConsSemanticHandler());
  registry.register(new SearchVConsHybridHandler());

  // Register tag handlers
  registry.register(new ManageTagHandler());
  registry.register(new GetTagsHandler());
  registry.register(new RemoveAllTagsHandler());
  registry.register(new SearchByTagsHandler());
  registry.register(new GetUniqueTagsHandler());

  // Register database handlers
  registry.register(new GetDatabaseShapeHandler());
  registry.register(new GetDatabaseStatsHandler());
  registry.register(new AnalyzeQueryHandler());

  // Register database analytics handlers
  registry.register(new GetDatabaseAnalyticsHandler());
  registry.register(new GetMonthlyGrowthAnalyticsHandler());
  registry.register(new GetAttachmentAnalyticsHandler());
  registry.register(new GetTagAnalyticsHandler());
  registry.register(new GetContentAnalyticsHandler());
  registry.register(new GetDatabaseHealthMetricsHandler());

  // Register database size handlers
  registry.register(new GetDatabaseSizeInfoHandler());
  registry.register(new GetSmartSearchLimitsHandler());

  return registry;
}

// Export registry type
export { ToolHandlerRegistry } from './registry.js';
export type { ToolHandler, ToolHandlerContext, ToolResponse } from './base.js';

