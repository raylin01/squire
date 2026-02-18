/**
 * Tool Frontmatter Parser
 *
 * Parses YAML frontmatter from tool.md files.
 */

import yaml from 'yaml';
import type { ToolFrontmatter } from '../types.js';

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n/;

export interface ParsedTool {
  frontmatter: ToolFrontmatter;
  content: string;
}

/**
 * Parse tool.md frontmatter and content
 */
export function parseToolFrontmatter(markdown: string): ParsedTool {
  const match = markdown.match(FRONTMATTER_REGEX);

  if (!match) {
    return {
      frontmatter: {
        name: 'Unknown Tool',
        description: 'No description provided',
        version: '0.0.0',
        inputSchema: { type: 'object', properties: {} },
      },
      content: markdown.trim(),
    };
  }

  const frontmatterYaml = match[1];
  const content = markdown.slice(match[0].length).trim();

  try {
    const parsed = yaml.parse(frontmatterYaml) as Partial<ToolFrontmatter>;

    // Apply defaults for required fields
    const frontmatter: ToolFrontmatter = {
      name: parsed.name || 'Unknown Tool',
      description: parsed.description || 'No description provided',
      version: parsed.version || '0.0.0',
      author: parsed.author,
      inputSchema: parsed.inputSchema || { type: 'object', properties: {} },
      metadata: parsed.metadata,
    };

    return {
      frontmatter,
      content,
    };
  } catch (error) {
    console.warn('[Tools] Failed to parse frontmatter:', error);
    return {
      frontmatter: {
        name: 'Parse Error',
        description: 'Failed to parse tool.md frontmatter',
        version: '0.0.0',
        inputSchema: { type: 'object', properties: {} },
      },
      content,
    };
  }
}

/**
 * Validate tool frontmatter
 */
export function validateToolFrontmatter(frontmatter: ToolFrontmatter): string[] {
  const errors: string[] = [];

  // Required fields
  if (!frontmatter.name || frontmatter.name.trim() === '') {
    errors.push('Tool name is required');
  }

  if (!frontmatter.description || frontmatter.description.trim() === '') {
    errors.push('Tool description is required');
  }

  if (!frontmatter.version) {
    errors.push('Tool version is required');
  }

  // Validate version format (simple semver check)
  if (frontmatter.version && !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(frontmatter.version)) {
    errors.push(`Invalid version format: ${frontmatter.version}. Expected semver (e.g., 1.0.0)`);
  }

  // Validate inputSchema
  if (frontmatter.inputSchema) {
    if (frontmatter.inputSchema.type !== 'object') {
      errors.push('inputSchema.type must be "object"');
    }

    if (frontmatter.inputSchema.properties && typeof frontmatter.inputSchema.properties !== 'object') {
      errors.push('inputSchema.properties must be an object');
    }

    if (frontmatter.inputSchema.required && !Array.isArray(frontmatter.inputSchema.required)) {
      errors.push('inputSchema.required must be an array');
    }
  }

  // Validate metadata.requires if present
  if (frontmatter.metadata?.squire?.requires) {
    const { bins, env } = frontmatter.metadata.squire.requires;

    if (bins && !Array.isArray(bins)) {
      errors.push('metadata.squire.requires.bins must be an array');
    }

    if (env && !Array.isArray(env)) {
      errors.push('metadata.squire.requires.env must be an array');
    }
  }

  return errors;
}

/**
 * Extract tool name from file path
 */
export function extractToolName(filePath: string): string {
  const parts = filePath.split('/');
  // Get the last part (the tool directory name)
  const dirName = parts[parts.length - 1] || 'unknown';
  return dirName;
}

/**
 * Check if tool name is valid
 */
export function isValidToolName(name: string): boolean {
  // Allow lowercase letters, numbers, underscores, and hyphens
  return /^[a-z][a-z0-9_-]*$/.test(name);
}

/**
 * Generate default tool.md content
 */
export function generateDefaultToolMd(name: string, description: string): string {
  const toolName = name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');

  return `---
name: ${toolName}
description: "${description}"
version: "1.0.0"
inputSchema:
  type: object
  properties:
    input:
      type: string
      description: "Input for the tool"
  required: [input]
metadata:
  squire:
    keywords: []
---

# ${toolName}

${description}

## Handler

\`\`\`typescript
export default async function(input: { input: string }, context: ToolHandlerContext) {
  // Implement your tool logic here
  return {
    success: true,
    result: "Tool executed successfully"
  };
}
\`\`\`

## Usage

Describe how to use this tool here.
`;
}
