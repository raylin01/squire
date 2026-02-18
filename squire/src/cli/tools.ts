/**
 * Tools CLI Commands
 *
 * Commands for managing external tools.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { loadConfig } from '../config.js';
import { createToolLoader } from '../tools/loader.js';
import { generateDefaultToolMd } from '../tools/frontmatter.js';
import { toolRegistry } from '../tools/index.js';
import {
  promptText,
  promptSelect,
  promptConfirm,
  displayHeader,
  displaySubHeader,
  displayInfo,
  displaySuccess,
  displayWarning,
  displayTable,
} from './prompts.js';

/**
 * List installed tools
 */
export async function listTools(): Promise<void> {
  displayHeader('Installed Tools');

  const config = loadConfig();

  if (!config) {
    displayInfo('No configuration found. Run `squire init` first.');
    return;
  }

  // Get built-in tools
  const builtinTools = toolRegistry.getBuiltin();

  console.log('\nBuilt-in Tools:');
  for (const tool of builtinTools) {
    console.log(`  • ${tool.name}: ${tool.description}`);
  }

  // Get external tools
  const loader = createToolLoader({
    globalDir: config.tools.globalDir,
    projectDir: config.tools.projectDir,
  });

  const externalTools = await loader.loadAll();

  if (externalTools.length > 0) {
    console.log('\nExternal Tools:');
    for (const tool of externalTools) {
      const status = tool.eligible ? '✓' : '✗';
      const source = tool.source === 'global' ? '(global)' : '(project)';
      console.log(`  ${status} ${tool.name} ${source}: ${tool.description}`);
      if (!tool.eligible && tool.eligibilityReason) {
        console.log(`      Reason: ${tool.eligibilityReason}`);
      }
    }
  } else {
    console.log('\nNo external tools installed.');
    console.log('Use `squire tools install <repo>` to install a tool.');
  }

  console.log('');
}

/**
 * Search for tools
 */
export async function searchTools(query: string): Promise<void> {
  displayHeader('Tool Search');

  if (!query) {
    query = await promptText('What kind of tool are you looking for?');
  }

  console.log(`\nSearching for: "${query}"\n`);

  // Use tool_search if available
  const searchTool = toolRegistry.get('tool_search');

  if (searchTool) {
    try {
      const result = await toolRegistry.execute('tool_search', { query, limit: 10 });
      console.log(result);
    } catch (error) {
      displayWarning(`Search error: ${error}`);
    }
  } else {
    // Fallback to simple search
    const allTools = toolRegistry.getAll();

    const queryLower = query.toLowerCase();
    const matches = allTools.filter(t =>
      t.name.toLowerCase().includes(queryLower) ||
      t.description.toLowerCase().includes(queryLower)
    );

    if (matches.length > 0) {
      console.log('Found tools:');
      for (const tool of matches) {
        console.log(`  • ${tool.name}: ${tool.description}`);
      }
    } else {
      displayInfo('No matching tools found.');
      console.log('You can create a new tool using `squire tools create <name>`.');
    }
  }

  console.log('');
}

/**
 * Install a tool from a repository
 */
export async function installTool(repository: string, destination?: 'global' | 'project'): Promise<void> {
  displayHeader('Install Tool');

  if (!repository) {
    repository = await promptText('Enter the git repository URL');
  }

  if (!destination) {
    destination = await promptSelect('Where to install?', [
      { value: 'global', label: 'Global', description: `~/.squire/tools (available everywhere)` },
      { value: 'project', label: 'Project', description: `./.squire/tools (this project only)` },
    ]) as 'global' | 'project';
  }

  console.log(`\nInstalling from ${repository}...\n`);

  // Use tool_install if available
  const installTool = toolRegistry.get('tool_install');

  if (installTool) {
    try {
      const result = await toolRegistry.execute('tool_install', { repository, destination });
      console.log(result);
    } catch (error) {
      displayWarning(`Install error: ${error}`);
    }
  } else {
    displayWarning('Tool installer not available. Please install manually:');
    console.log(`  git clone --depth 1 ${repository} ~/.squire/tools/<tool-name>`);
  }
}

/**
 * Create a new tool
 */
export async function createTool(name?: string, description?: string): Promise<void> {
  displayHeader('Create Tool');

  if (!name) {
    name = await promptText('Tool name (lowercase, use hyphens)');
  }

  if (!description) {
    description = await promptText('Tool description');
  }

  // Validate name
  if (!name || !/^[a-z][a-z0-9_-]*$/.test(name)) {
    displayWarning('Tool name must start with a lowercase letter and contain only lowercase letters, numbers, hyphens, and underscores.');
    return;
  }

  const config = loadConfig();

  const destination = await promptSelect('Where to create?', [
    { value: 'global', label: 'Global', description: `~/.squire/tools (available everywhere)` },
    { value: 'project', label: 'Project', description: `./.squire/tools (this project only)` },
  ]) as 'global' | 'project';

  const toolsDir = destination === 'project'
    ? path.join(process.cwd(), '.squire', 'tools')
    : path.join(os.homedir(), '.squire', 'tools');

  const toolPath = path.join(toolsDir, name);

  // Check if already exists
  if (fs.existsSync(toolPath)) {
    displayWarning(`Tool "${name}" already exists at ${toolPath}`);
    const overwrite = await promptConfirm('Overwrite?', false);
    if (!overwrite) {
      return;
    }
    fs.rmSync(toolPath, { recursive: true, force: true });
  }

  // Create directory
  fs.mkdirSync(toolPath, { recursive: true });

  // Generate tool.md
  const toolMd = generateDefaultToolMd(name, description);
  fs.writeFileSync(path.join(toolPath, 'tool.md'), toolMd, 'utf-8');

  // Generate handler.ts
  const handlerTs = `/**
 * ${name}
 *
 * ${description}
 */

import type { ToolHandlerContext } from '@squire/core';

interface ${toPascalCase(name)}Input {
  input: string;
}

export default async function ${toCamelCase(name)}Handler(
  input: ${toPascalCase(name)}Input,
  context: ToolHandlerContext
): Promise<{ success: boolean; result?: string; error?: string }> {
  try {
    // TODO: Implement your tool logic here
    console.log('[${name}] Executing with input:', input);

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

  fs.writeFileSync(path.join(toolPath, 'handler.ts'), handlerTs, 'utf-8');

  displaySuccess(`Tool "${name}" created at ${toolPath}`);
  console.log('\nFiles created:');
  console.log(`  - ${toolPath}/tool.md`);
  console.log(`  - ${toolPath}/handler.ts`);
  console.log('\nEdit these files to implement your tool functionality.');
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
