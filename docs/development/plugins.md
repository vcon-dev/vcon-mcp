# vCon MCP Server - Plugin Development Guide

## Overview

The vCon MCP Server supports a plugin architecture that allows you to extend its functionality with custom features. This guide explains how to create your own plugins.

## Plugin Interface

Plugins implement the `VConPlugin` interface which provides lifecycle hooks and tool registration capabilities.

### Basic Plugin Structure

```typescript
import { VConPlugin, RequestContext } from '@vcon/mcp-server/hooks';
import { VCon } from '@vcon/mcp-server/types';
import { Tool } from '@modelcontextprotocol/sdk/types';

export default class MyPlugin implements VConPlugin {
  name = 'my-plugin';
  version = '1.0.0';
  
  async initialize(config: any): Promise<void> {
    console.error('✅ My Plugin initialized');
  }
  
  async shutdown(): Promise<void> {
    console.error('👋 My Plugin shutting down');
  }
  
  // Implement hooks as needed...
}
```

## Available Hooks

### Lifecycle Hooks

#### `initialize(config)`
Called when the server starts up. Use this to set up connections, load configuration, etc.

```typescript
async initialize(config: any): Promise<void> {
  this.supabase = config.supabase;
  this.queries = config.queries;
}
```

#### `shutdown()`
Called when the server is shutting down. Clean up resources here.

```typescript
async shutdown(): Promise<void> {
  await this.database.disconnect();
}
```

### Data Operation Hooks

#### `beforeCreate(vcon, context)`
Called before a vCon is created. Can modify the vCon or throw to block creation.

```typescript
async beforeCreate(vcon: VCon, context: RequestContext): Promise<VCon> {
  // Add custom metadata
  vcon.extensions = vcon.extensions || [];
  vcon.extensions.push('my-plugin-v1');
  
  return vcon;
}
```

#### `afterCreate(vcon, context)`
Called after a vCon is successfully created.

```typescript
async afterCreate(vcon: VCon, context: RequestContext): Promise<void> {
  // Send notification, log to external system, etc.
  await this.notifyExternalSystem(vcon);
}
```

#### `beforeRead(uuid, context)`
Called before a vCon is read. Throw an error to block access.

```typescript
async beforeRead(uuid: string, context: RequestContext): Promise<void> {
  // Check access permissions
  if (!this.hasAccess(context.userId, uuid)) {
    throw new Error('Access denied');
  }
}
```

#### `afterRead(vcon, context)`
Called after a vCon is read. Can modify the returned data (e.g., redact sensitive information).

```typescript
async afterRead(vcon: VCon, context: RequestContext): Promise<VCon> {
  // Redact email addresses from parties
  vcon.parties = vcon.parties?.map(party => ({
    ...party,
    mailto: '[REDACTED]'
  }));
  
  return vcon;
}
```

#### `beforeUpdate(uuid, updates, context)`
Called before a vCon is updated.

```typescript
async beforeUpdate(uuid: string, updates: any, context: RequestContext): Promise<void> {
  // Validate updates meet business rules
  await this.validateBusinessRules(updates);
}
```

#### `afterUpdate(vcon, context)`
Called after a vCon is updated.

```typescript
async afterUpdate(vcon: VCon, context: RequestContext): Promise<void> {
  // Update cache, send webhooks, etc.
  await this.invalidateCache(vcon.uuid);
}
```

#### `beforeDelete(uuid, context)`
Called before a vCon is deleted. Throw to prevent deletion.

```typescript
async beforeDelete(uuid: string, context: RequestContext): Promise<void> {
  // Check if vCon has legal hold
  if (await this.hasLegalHold(uuid)) {
    throw new Error('Cannot delete: legal hold active');
  }
}
```

#### `afterDelete(uuid, context)`
Called after a vCon is deleted.

```typescript
async afterDelete(uuid: string, context: RequestContext): Promise<void> {
  // Clean up related resources
  await this.deleteRelatedFiles(uuid);
}
```

#### `beforeSearch(criteria, context)`
Called before searching vCons. Can modify search criteria.

```typescript
async beforeSearch(criteria: SearchCriteria, context: RequestContext): Promise<SearchCriteria> {
  // Add tenant filter based on user
  return {
    ...criteria,
    tenantId: context.userId
  };
}
```

#### `afterSearch(results, context)`
Called after searching vCons. Can filter or modify results.

```typescript
async afterSearch(results: VCon[], context: RequestContext): Promise<VCon[]> {
  // Filter out sensitive vCons
  return results.filter(vcon => !this.isSensitive(vcon));
}
```

### Tool Registration

#### `registerTools()`
Register additional MCP tools that will be exposed to clients.

```typescript
registerTools(): Tool[] {
  return [
    {
      name: 'my_custom_tool',
      description: 'Does something custom',
      inputSchema: {
        type: 'object',
        properties: {
          param: { type: 'string', description: 'A parameter' }
        },
        required: ['param']
      }
    }
  ];
}
```

**Note:** You'll need to handle the tool execution in your plugin by registering a tool handler separately.

#### `registerResources()`
Register additional MCP resources.

```typescript
registerResources(): Resource[] {
  return [
    {
      uri: 'myplugin://stats',
      name: 'Plugin Statistics',
      mimeType: 'application/json'
    }
  ];
}
```

## Request Context

All hooks receive a `RequestContext` object with information about the request:

```typescript
interface RequestContext {
  userId?: string;        // User making the request
  purpose?: string;       // Purpose of the operation
  ipAddress?: string;     // Client IP address
  timestamp: Date;        // When the request was made
  metadata?: Record<string, any>;  // Additional metadata
}
```

## Loading Plugins

### Via Environment Variable

Set the `VCON_PLUGINS_PATH` environment variable to load plugins:

```bash
# Single plugin
VCON_PLUGINS_PATH=./my-plugin.js

# Multiple plugins (comma-separated)
VCON_PLUGINS_PATH=@vcon/privacy-suite,./custom-plugin.js

# From npm package
VCON_PLUGINS_PATH=@mycompany/vcon-plugin
```

### Plugin Configuration

Plugins receive configuration from environment variables:

```bash
VCON_LICENSE_KEY=your-license-key
VCON_OFFLINE_MODE=false
```

Access these in your plugin constructor:

```typescript
constructor(config: any) {
  this.licenseKey = config.licenseKey;
  this.offlineMode = config.offlineMode;
  this.supabase = config.supabase;
}
```

## Example: Simple Logging Plugin

```typescript
import { VConPlugin, RequestContext } from '@vcon/mcp-server/hooks';
import { VCon } from '@vcon/mcp-server/types';

export default class LoggingPlugin implements VConPlugin {
  name = 'logging-plugin';
  version = '1.0.0';
  
  async initialize(config: any): Promise<void> {
    console.error('✅ Logging Plugin initialized');
  }
  
  async afterCreate(vcon: VCon, context: RequestContext): Promise<void> {
    console.error(`📝 vCon created: ${vcon.uuid} by user ${context.userId}`);
  }
  
  async afterRead(vcon: VCon, context: RequestContext): Promise<VCon> {
    console.error(`👀 vCon read: ${vcon.uuid} by user ${context.userId}`);
    return vcon;
  }
  
  async afterDelete(uuid: string, context: RequestContext): Promise<void> {
    console.error(`🗑️  vCon deleted: ${uuid} by user ${context.userId}`);
  }
}
```

## Example: Access Control Plugin

```typescript
import { VConPlugin, RequestContext } from '@vcon/mcp-server/hooks';
import { VCon } from '@vcon/mcp-server/types';

export default class AccessControlPlugin implements VConPlugin {
  name = 'access-control';
  version = '1.0.0';
  
  private permissions: Map<string, Set<string>> = new Map();
  
  async initialize(config: any): Promise<void> {
    // Load permissions from database
    await this.loadPermissions(config.supabase);
  }
  
  async beforeRead(uuid: string, context: RequestContext): Promise<void> {
    if (!context.userId) {
      throw new Error('Authentication required');
    }
    
    const userPermissions = this.permissions.get(context.userId);
    if (!userPermissions?.has(uuid)) {
      throw new Error(`Access denied to vCon ${uuid}`);
    }
  }
  
  async beforeDelete(uuid: string, context: RequestContext): Promise<void> {
    if (!context.userId) {
      throw new Error('Authentication required');
    }
    
    const userPermissions = this.permissions.get(context.userId);
    if (!userPermissions?.has(uuid)) {
      throw new Error(`Cannot delete vCon ${uuid}: access denied`);
    }
  }
  
  private async loadPermissions(supabase: any): Promise<void> {
    // Load from database
    const { data } = await supabase
      .from('permissions')
      .select('user_id, vcon_uuid');
    
    for (const perm of data || []) {
      if (!this.permissions.has(perm.user_id)) {
        this.permissions.set(perm.user_id, new Set());
      }
      this.permissions.get(perm.user_id)!.add(perm.vcon_uuid);
    }
  }
}
```

## Testing Your Plugin

Create a test file:

```typescript
import MyPlugin from './my-plugin';
import { VCon } from '@vcon/mcp-server/types';

const plugin = new MyPlugin({
  licenseKey: 'test-key',
  offlineMode: true
});

await plugin.initialize({});

const vcon: VCon = {
  vcon: '0.3.0',
  uuid: '123e4567-e89b-12d3-a456-426614174000',
  created_at: new Date().toISOString(),
  parties: []
};

const context = {
  timestamp: new Date(),
  userId: 'test-user'
};

const modified = await plugin.beforeCreate(vcon, context);
console.log('Modified vCon:', modified);
```

## Best Practices

1. **Error Handling**: Always catch and properly handle errors in hooks
2. **Performance**: Keep hook execution fast - avoid slow operations
3. **Logging**: Use `console.error()` for plugin logs (stdout is reserved for MCP protocol)
4. **Type Safety**: Use TypeScript and proper type annotations
5. **Documentation**: Document your plugin's configuration options and behavior
6. **Testing**: Write tests for your plugin hooks
7. **Versioning**: Use semantic versioning for your plugin

## Publishing Your Plugin

### As npm Package

1. Create `package.json`:

```json
{
  "name": "@mycompany/vcon-plugin",
  "version": "1.0.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "peerDependencies": {
    "@vcon/mcp-server": "^1.0.0"
  }
}
```

2. Build and publish:

```bash
npm run build
npm publish
```

3. Users install with:

```bash
npm install @mycompany/vcon-plugin
```

### As Local Module

Users can load plugins from local files:

```bash
VCON_PLUGINS_PATH=./plugins/my-plugin.js
```

## Plugin Ideas

- **Audit Logging**: Log all operations to external system
- **Webhooks**: Send notifications on vCon events
- **Encryption**: Encrypt sensitive fields at rest
- **Multi-tenancy**: Enforce tenant isolation
- **Rate Limiting**: Limit operations per user
- **Caching**: Cache frequently accessed vCons
- **Analytics**: Collect usage statistics
- **Validation**: Enforce custom business rules
- **Integration**: Sync with external systems (CRM, etc.)

## Support

For questions or issues with plugin development:
- Create an issue on GitHub
- Join our community discussions
- Review the plugin interface source code

## License

When creating plugins, ensure they comply with the MIT license of the core server, or clearly state your plugin's license.

