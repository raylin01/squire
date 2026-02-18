/**
 * Squire Tool Registry
 *
 * Manages built-in tools for Squire and external tools from the ToolLoader.
 */

import type { SDKTool } from '../sdk/types.js';
import type { SquireTool, ToolHandlerContext } from '../types.js';
import type { ToolLoader, ToolHandler as ExternalToolHandler } from './loader.js';

export interface ToolHandler {
  (input: Record<string, unknown>): Promise<string>;
}

export interface RegisteredTool extends SDKTool {
  handler: ToolHandler;
  source?: 'builtin' | 'external';
  externalPath?: string;
}

class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();
  private toolLoader: ToolLoader | null = null;

  register(tool: SDKTool, handler: ToolHandler): void {
    this.tools.set(tool.name, {
      ...tool,
      handler,
      source: 'builtin',
    });
  }

  /**
   * Set the tool loader for external tools
   */
  setToolLoader(loader: ToolLoader): void {
    this.toolLoader = loader;
  }

  /**
   * Get the tool loader
   */
  getToolLoader(): ToolLoader | null {
    return this.toolLoader;
  }

  /**
   * Load external tools from the ToolLoader
   */
  async loadExternalTools(): Promise<SquireTool[]> {
    if (!this.toolLoader) {
      return [];
    }

    const externalTools = await this.toolLoader.loadAll();

    for (const tool of externalTools) {
      if (!tool.eligible) {
        console.log(`[Tools] Skipping ineligible tool: ${tool.name} (${tool.eligibilityReason})`);
        continue;
      }

      // Get handler from loader
      const handler = this.toolLoader.getHandler(tool.name);

      if (handler) {
        // Register as external tool with wrapper
        this.tools.set(tool.name, {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.frontmatter.inputSchema,
          handler: this.wrapExternalHandler(handler),
          source: 'external',
          externalPath: tool.path,
        });
      }
    }

    return externalTools;
  }

  /**
   * Wrap an external tool handler to match the internal signature
   */
  private wrapExternalHandler(handler: ExternalToolHandler): ToolHandler {
    return async (input: Record<string, unknown>) => {
      const context: ToolHandlerContext = {
        squireId: 'squire',
        config: {} as any,
      };

      const result = await handler(input, context);

      if (typeof result === 'string') {
        return result;
      }

      return JSON.stringify(result, null, 2);
    };
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getAll(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get only built-in tools
   */
  getBuiltin(): RegisteredTool[] {
    return this.getAll().filter(t => t.source === 'builtin');
  }

  /**
   * Get only external tools
   */
  getExternal(): RegisteredTool[] {
    return this.getAll().filter(t => t.source === 'external');
  }

  getToolDefinitions(): SDKTool[] {
    return this.getAll().map(({ handler, source, externalPath, ...tool }) => tool);
  }

  async execute(name: string, input: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return tool.handler(input);
  }
}

export const toolRegistry = new ToolRegistry();

// Re-export setSquireInstance from self-modify
export { setSquireInstance } from './self-modify.js';

// Helper to define tools
export function defineTool(
  name: string,
  description: string,
  properties: Record<string, { type: string; description?: string; enum?: string[] }>,
  required: string[],
  handler: ToolHandler
): void {
  toolRegistry.register({
    name,
    description,
    inputSchema: {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    },
  }, handler);
}

// Import all tools to register them
import './communicate.js';
import './self-manage.js';
import './self-modify.js';
import './memory.js';
import './scheduler.js';
import './tickets.js';

// Re-export
export * from './communicate.js';
export * from './self-manage.js';
export * from './self-modify.js';
export * from './memory.js';
export * from './scheduler.js';
export * from './tickets.js';
export * from './loader.js';
export * from './frontmatter.js';
