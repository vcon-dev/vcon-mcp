/**
 * Core tool names registered in src/server/handlers.ts (matches server inventory;
 * excludes plugin-injected tools).
 */

import { allTools } from '../../src/tools/vcon-crud.js';
import { createFromTemplateTool } from '../../src/tools/templates.js';
import { getSchemaTool, getExamplesTool } from '../../src/tools/schema-tools.js';
import { allDatabaseTools } from '../../src/tools/database-tools.js';
import { allDatabaseAnalyticsTools } from '../../src/tools/database-analytics.js';
import { allDatabaseSizeTools } from '../../src/tools/database-size-tools.js';
import { allTagTools } from '../../src/tools/tag-tools.js';

export const REGISTERED_CORE_TOOL_NAMES: string[] = [
  ...allTools.map((t) => t.name),
  createFromTemplateTool.name,
  getSchemaTool.name,
  getExamplesTool.name,
  ...allDatabaseTools.map((t) => t.name),
  ...allDatabaseAnalyticsTools.map((t) => t.name),
  ...allDatabaseSizeTools.map((t) => t.name),
  ...allTagTools.map((t) => t.name),
];

export const REGISTERED_CORE_TOOL_SET = new Set(REGISTERED_CORE_TOOL_NAMES);
