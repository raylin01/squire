/**
 * Tool Create Handler
 *
 * Creates a new Squire tool scaffold.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { ToolHandlerContext } from '../../../types.js';

interface ToolProperty {
  type: string;
  description?: string;
  enum?: string[];
  default?: unknown;
}

interface ToolCreateInput {
  name: string;
  description: string;
  inputProperties?: Record<string, ToolProperty>;
  requiredInputs?: string[];
  destination?: 'global' | 'project';
}

export default async function toolCreateHandler(
  input: ToolCreateInput,
  context: ToolHandlerContext
): Promise<{ success: boolean; message: string; path?: string; toolName?: string }> {
  const {
    name: rawName,
    description,
    inputProperties = {},
    requiredInputs = [],
    destination = 'global'
  } = input;

  if (!rawName || rawName.trim() === '') {
    return {
      success: false,
      message: 'Tool name is required',
    };
  }

  if (!description || description.trim() === '') {
    return {
      success: false,
      message: 'Tool description is required',
    };
  }

  try {
    // Sanitize tool name
    const toolName = rawName
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/^-+|-+$/g, '');

    if (!toolName || toolName.length < 2) {
      return {
        success: false,
        message: 'Tool name must be at least 2 characters after sanitization',
      };
    }

    // Determine destination directory
    const toolsDir = destination === 'project'
      ? path.join(process.cwd(), '.squire', 'tools')
      : path.join(os.homedir(), '.squire', 'tools');

    // Ensure directory exists
    if (!fs.existsSync(toolsDir)) {
      fs.mkdirSync(toolsDir, { recursive: true });
    }

    const toolPath = path.join(toolsDir, toolName);

    // Check if tool already exists
    if (fs.existsSync(toolPath)) {
      return {
        success: false,
        message: `Tool "${toolName}" already exists at ${toolPath}. Choose a different name or remove the existing tool.`,
      };
    }

    // Create tool directory
    fs.mkdirSync(toolPath, { recursive: true });

    // Generate tool.md content
    const propertiesYaml = Object.entries(inputProperties)
      .map(([key, prop]) => {
        let propYaml = `      ${key}:\n        type: ${prop.type}`;
        if (prop.description) {
          propYaml += `\n        description: "${prop.description}"`;
        }
        if (prop.enum) {
          propYaml += `\n        enum: [${prop.enum.map(e => `"${e}"`).join(', ')}]`;
        }
        return propYaml;
      })
      .join('\n');

    const requiredYaml = requiredInputs.length > 0
      ? `\n  required: [${requiredInputs.map(r => `"${r}"`).join(', ')}]`
      : '';

    const toolMdContent = `---
name: ${toolName}
description: "${description}"
version: "1.0.0"
inputSchema:
  type: object
  properties:
${propertiesYaml || '    input:\n      type: string\n      description: "Input for the tool"'}${requiredYaml}
metadata:
  squire:
    keywords: []
---

# ${toolName}

${description}

## Handler

\`\`\`typescript
export default async function(input: any, context: ToolHandlerContext) {
  // TODO: Implement your tool logic here

  return {
    success: true,
    result: "Tool executed successfully"
  };
}
\`\`\`

## Usage

Describe how to use this tool here.
`;

    // Generate handler.ts content
    const inputInterface = Object.entries(inputProperties)
      .map(([key, prop]) => {
        const tsType = prop.type === 'string' ? 'string' :
          prop.type === 'number' ? 'number' :
            prop.type === 'boolean' ? 'boolean' :
              prop.type === 'array' ? 'any[]' : 'any';
        return `  ${key}${requiredInputs.includes(key) ? '' : '?'}: ${tsType};`;
      })
      .join('\n');

    const handlerContent = `/**
 * ${toolName}
 *
 * ${description}
 */

import type { ToolHandlerContext } from '../../../types.js';

interface ${toPascalCase(toolName)}Input {
${inputInterface || '  input?: string;'}
}

export default async function ${toCamelCase(toolName)}Handler(
  input: ${toPascalCase(toolName)}Input,
  context: ToolHandlerContext
): Promise<{ success: boolean; result?: string; error?: string }> {
  try {
    // TODO: Implement your tool logic here
    console.log('[${toolName}] Executing with input:', input);

    return {
      success: true,
      result: 'Tool executed successfully. Implement your logic here.',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
`;

    // Write files
    fs.writeFileSync(path.join(toolPath, 'tool.md'), toolMdContent, 'utf-8');
    fs.writeFileSync(path.join(toolPath, 'handler.ts'), handlerContent, 'utf-8');

    return {
      success: true,
      message: `Successfully created tool "${toolName}" at ${toolPath}`,
      path: toolPath,
      toolName,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed to create tool: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Convert kebab-case to PascalCase
 */
function toPascalCase(str: string): string {
  return str
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

/**
 * Convert kebab-case to camelCase
 */
function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}
