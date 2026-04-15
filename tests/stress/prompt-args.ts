/**
 * Minimal MCP prompt arguments for getPrompt (aligned with generatePromptMessage keys).
 */

export function minimalPromptArgs(name: string): Record<string, string> {
  switch (name) {
    case 'find_by_exact_tags':
      return { tag_criteria: 'department:sales' };
    case 'find_by_semantic_search':
      return { search_description: 'billing complaints' };
    case 'find_by_keywords':
      return { keywords: 'refund' };
    case 'find_recent_by_topic':
      return { topic: 'support', timeframe: 'recent' };
    case 'find_by_customer':
      return { party_identifier: 'test@example.com' };
    case 'discover_available_tags':
      return { tag_category: 'all' };
    case 'complex_search':
      return { search_criteria: 'priority high last week' };
    case 'find_similar_conversations':
      return { reference: 'late shipment', limit: '5' };
    case 'help_me_search':
      return { what_you_want: 'How do I search by tag?' };
    case 'daily_activity_report':
      return { date: 'today', focus_areas: 'volume' };
    default:
      return {};
  }
}
