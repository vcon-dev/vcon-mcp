/**
 * Example Plugin: Simple Logging Plugin
 * 
 * This plugin demonstrates how to create a basic vCon plugin that logs
 * operations to the console.
 * 
 * Usage:
 *   VCON_PLUGINS_PATH=./examples/logging-plugin.js npm run dev
 */

export default class LoggingPlugin {
  constructor(config) {
    this.name = 'logging-plugin';
    this.version = '1.0.0';
    this.config = config;
  }
  
  async initialize(serverConfig) {
    console.error('✅ Logging Plugin initialized');
    console.error('   Config:', {
      hasSupabase: !!serverConfig.supabase,
      hasQueries: !!serverConfig.queries
    });
  }
  
  async shutdown() {
    console.error('👋 Logging Plugin shutting down');
  }
  
  // Hook: Log vCon creation
  async afterCreate(vcon, context) {
    console.error(`📝 vCon created: ${vcon.uuid}`);
    console.error(`   Subject: ${vcon.subject || '(no subject)'}`);
    console.error(`   Parties: ${vcon.parties?.length || 0}`);
    console.error(`   By user: ${context.userId || 'anonymous'}`);
  }
  
  // Hook: Log vCon reads
  async afterRead(vcon, context) {
    console.error(`👀 vCon read: ${vcon.uuid}`);
    console.error(`   Subject: ${vcon.subject || '(no subject)'}`);
    console.error(`   By user: ${context.userId || 'anonymous'}`);
    console.error(`   Purpose: ${context.purpose || 'unspecified'}`);
    
    // Return vcon unchanged
    return vcon;
  }
  
  // Hook: Log vCon deletion
  async afterDelete(uuid, context) {
    console.error(`🗑️  vCon deleted: ${uuid}`);
    console.error(`   By user: ${context.userId || 'anonymous'}`);
  }
  
  // Hook: Log search operations
  async afterSearch(results, context) {
    console.error(`🔍 Search completed: ${results.length} results`);
    console.error(`   By user: ${context.userId || 'anonymous'}`);
    
    // Return results unchanged
    return results;
  }
}

