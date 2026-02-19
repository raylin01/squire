/**
 * Tool Registry - Core registry without circular dependencies
 *
 * This file is separate from index.ts to avoid circular imports.
 * Other tool files can safely import from here.
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

/**
 * Execution context passed to tools during execution.
 * This is set before tool execution and cleared after.
 */
export interface ToolExecutionContext {
  workspaceId?: string;
}

// Current execution context (thread-local pattern)
let currentExecutionContext: ToolExecutionContext = {};

export function setExecutionContext(context: ToolExecutionContext): void {
  currentExecutionContext = context;
}

export function getExecutionContext(): ToolExecutionContext {
  return currentExecutionContext;
}

export function clearExecutionContext(): void {
  currentExecutionContext = {};
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

  setToolLoader(loader: ToolLoader): void {
    this.toolLoader = loader;
  }

  getToolLoader(): ToolLoader | null {
    return this.toolLoader;
  }

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

      const handler = this.toolLoader.getHandler(tool.name);

      if (handler) {
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

  getBuiltin(): RegisteredTool[] {
    return this.getAll().filter(t => t.source === 'builtin');
  }

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

/**
 * Helper to define tools
 */
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
