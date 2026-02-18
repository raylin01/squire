/**
 * Tool Search Handler
 *
 * Searches for tools using QMD semantic search.
 */

import type { ToolHandlerContext } from '../../../types.js';
import { toolRegistry } from '../../index.js';

interface ToolSearchInput {
  query: string;
  limit?: number;
}

interface ToolSearchResult {
  name: string;
  description: string;
  source: 'builtin' | 'external';
  path?: string;
  score?: number;
}

export default async function toolSearchHandler(
  input: ToolSearchInput,
  context: ToolHandlerContext
): Promise<{ success: boolean; results: ToolSearchResult[]; message: string }> {
  const { query, limit = 5 } = input;

  if (!query || query.trim() === '') {
    return {
      success: false,
      results: [],
      message: 'Query is required',
    };
  }

  try {
    // Get all available tools
    const allTools = toolRegistry.getAll();

    // Simple keyword matching for now
    // In the future, this could use QMD for semantic search
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/);

    const results: (ToolSearchResult & { score: number })[] = [];

    for (const tool of allTools) {
      const nameLower = tool.name.toLowerCase();
      const descLower = tool.description.toLowerCase();

      // Calculate a simple relevance score
      let score = 0;

      // Exact name match
      if (nameLower === queryLower) {
        score += 10;
      }

      // Name contains query
      if (nameLower.includes(queryLower)) {
        score += 5;
      }

      // Query words in name
      for (const word of queryWords) {
        if (nameLower.includes(word)) {
          score += 2;
        }
      }

      // Query words in description
      for (const word of queryWords) {
        if (descLower.includes(word)) {
          score += 1;
        }
      }

      // Only include if there's some relevance
      if (score > 0) {
        results.push({
          name: tool.name,
          description: tool.description,
          source: tool.source || 'builtin',
          path: tool.externalPath,
          score,
        });
      }
    }

    // Sort by score and limit
    results.sort((a, b) => b.score - a.score);
    const limitedResults = results.slice(0, limit);

    // Remove score from output
    const outputResults: ToolSearchResult[] = limitedResults.map(({ score: _, ...rest }) => rest);

    let message = `Found ${outputResults.length} tool(s) matching "${query}"`;

    if (outputResults.length === 0) {
      message = `No tools found matching "${query}". You can create a new tool using the tool_create tool.`;
    }

    return {
      success: true,
      results: outputResults,
      message,
    };
  } catch (error) {
    return {
      success: false,
      results: [],
      message: `Error searching tools: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
