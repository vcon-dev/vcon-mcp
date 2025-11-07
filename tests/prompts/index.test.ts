/**
 * Tests for prompts module
 */

import { describe, it, expect } from 'vitest';
import {
  allPrompts,
  generatePromptMessage,
  findByExactTagPrompt,
  findBySemanticSearchPrompt,
  findByKeywordPrompt,
  findRecentByTopicPrompt,
  findByPartyPrompt,
  discoverTagsPrompt,
  complexSearchPrompt,
  findSimilarPrompt,
  queryStrategyPrompt,
  type PromptDefinition,
} from '../../src/prompts/index.js';

describe('Prompts', () => {
  describe('Prompt Definitions', () => {
    it('should export allPrompts array', () => {
      expect(Array.isArray(allPrompts)).toBe(true);
      expect(allPrompts.length).toBeGreaterThan(0);
    });

    it('should have findByExactTagPrompt with correct structure', () => {
      expect(findByExactTagPrompt).toHaveProperty('name', 'find_by_exact_tags');
      expect(findByExactTagPrompt).toHaveProperty('description');
      expect(findByExactTagPrompt.arguments).toBeDefined();
      expect(Array.isArray(findByExactTagPrompt.arguments)).toBe(true);
    });

    it('should have findBySemanticSearchPrompt with correct structure', () => {
      expect(findBySemanticSearchPrompt).toHaveProperty('name', 'find_by_semantic_search');
      expect(findBySemanticSearchPrompt).toHaveProperty('description');
      expect(findBySemanticSearchPrompt.arguments).toBeDefined();
    });

    it('should have findByKeywordPrompt with correct structure', () => {
      expect(findByKeywordPrompt).toHaveProperty('name', 'find_by_keywords');
      expect(findByKeywordPrompt).toHaveProperty('description');
      expect(findByKeywordPrompt.arguments).toBeDefined();
    });

    it('should have findRecentByTopicPrompt with correct structure', () => {
      expect(findRecentByTopicPrompt).toHaveProperty('name', 'find_recent_by_topic');
      expect(findRecentByTopicPrompt).toHaveProperty('description');
      expect(findRecentByTopicPrompt.arguments).toBeDefined();
    });

    it('should have findByPartyPrompt with correct structure', () => {
      expect(findByPartyPrompt).toHaveProperty('name', 'find_by_customer');
      expect(findByPartyPrompt).toHaveProperty('description');
      expect(findByPartyPrompt.arguments).toBeDefined();
    });

    it('should have discoverTagsPrompt with correct structure', () => {
      expect(discoverTagsPrompt).toHaveProperty('name', 'discover_available_tags');
      expect(discoverTagsPrompt).toHaveProperty('description');
    });

    it('should have complexSearchPrompt with correct structure', () => {
      expect(complexSearchPrompt).toHaveProperty('name', 'complex_search');
      expect(complexSearchPrompt).toHaveProperty('description');
      expect(complexSearchPrompt.arguments).toBeDefined();
    });

    it('should have findSimilarPrompt with correct structure', () => {
      expect(findSimilarPrompt).toHaveProperty('name', 'find_similar_conversations');
      expect(findSimilarPrompt).toHaveProperty('description');
      expect(findSimilarPrompt.arguments).toBeDefined();
    });

    it('should have queryStrategyPrompt with correct structure', () => {
      expect(queryStrategyPrompt).toHaveProperty('name', 'help_me_search');
      expect(queryStrategyPrompt).toHaveProperty('description');
    });

    it('should have all prompts in allPrompts array', () => {
      const promptNames = allPrompts.map(p => p.name);
      expect(promptNames).toContain('find_by_exact_tags');
      expect(promptNames).toContain('find_by_semantic_search');
      expect(promptNames).toContain('find_by_keywords');
      expect(promptNames).toContain('find_recent_by_topic');
      expect(promptNames).toContain('find_by_customer');
      expect(promptNames).toContain('discover_available_tags');
      expect(promptNames).toContain('complex_search');
      expect(promptNames).toContain('find_similar_conversations');
      expect(promptNames).toContain('help_me_search');
      // Verify we have at least these core prompts
      expect(promptNames.length).toBeGreaterThanOrEqual(9);
    });

    it('should have unique prompt names', () => {
      const names = allPrompts.map(p => p.name);
      const uniqueNames = new Set(names);
      expect(names.length).toBe(uniqueNames.size);
    });

    it('should have valid prompt argument structures', () => {
      allPrompts.forEach(prompt => {
        if (prompt.arguments) {
          prompt.arguments.forEach(arg => {
            expect(arg).toHaveProperty('name');
            expect(arg).toHaveProperty('description');
            expect(arg).toHaveProperty('required');
            expect(typeof arg.name).toBe('string');
            expect(typeof arg.description).toBe('string');
            expect(typeof arg.required).toBe('boolean');
          });
        }
      });
    });
  });

  describe('generatePromptMessage', () => {
    it('should generate message for find_by_exact_tags', () => {
      const message = generatePromptMessage('find_by_exact_tags', {
        tag_criteria: 'angry customers',
        date_range: 'June',
      });

      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
      expect(message).toContain('angry customers');
      expect(message).toContain('June');
    });

    it('should generate message for find_by_semantic_search', () => {
      const message = generatePromptMessage('find_by_semantic_search', {
        search_description: 'billing disputes',
      });

      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
      expect(message).toContain('billing disputes');
    });

    it('should generate message for find_by_keywords', () => {
      const message = generatePromptMessage('find_by_keywords', {
        keywords: 'refund',
      });

      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
      expect(message).toContain('refund');
    });

    it('should generate message for find_recent_by_topic', () => {
      const message = generatePromptMessage('find_recent_by_topic', {
        topic: 'support',
      });

      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
      expect(message).toContain('support');
    });

    it('should generate message for find_by_party', () => {
      const message = generatePromptMessage('find_by_party', {
        party_identifier: 'alice@example.com',
      });

      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    });

    it('should generate message for discover_tags', () => {
      const message = generatePromptMessage('discover_tags', {});

      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    });

    it('should generate message for complex_search', () => {
      const message = generatePromptMessage('complex_search', {
        search_criteria: 'multiple filters',
      });

      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    });

    it('should generate message for find_similar', () => {
      const message = generatePromptMessage('find_similar', {
        vcon_uuid: 'test-uuid',
      });

      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    });

    it('should generate message for query_strategy', () => {
      const message = generatePromptMessage('query_strategy', {
        goal: 'find customer issues',
      });

      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    });

    it('should handle missing arguments gracefully', () => {
      const message = generatePromptMessage('find_by_exact_tags', {});

      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    });

    it('should handle unknown prompt name', () => {
      const message = generatePromptMessage('unknown_prompt', {});

      expect(typeof message).toBe('string');
      // Should return some default message or error message
    });

    it('should include all provided arguments in message', () => {
      const message = generatePromptMessage('find_by_exact_tags', {
        tag_criteria: 'test criteria',
        date_range: 'test range',
        extra_arg: 'should be included',
      });

      expect(message).toContain('test criteria');
      expect(message).toContain('test range');
    });
  });
});

