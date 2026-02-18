/**
 * Tool Loader
 *
 * Loads external tools from multiple directories with priority ordering.
 * Priority: project > global > bundled
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import type { SquireTool, ToolFrontmatter, ToolHandlerContext } from '../types.js';
import { parseToolFrontmatter, extractToolName, validateToolFrontmatter } from './frontmatter.js';

export interface ToolLoaderOptions {
  globalDir?: string;     // ~/.squire/tools
  projectDir?: string;    // ./.squire/tools
  bundledDir?: string;    // bundled tools
}

// Tool file names to look for
const TOOL_FILE_NAMES = ['tool.md', 'TOOL.md'];

// Handler file names to look for
const HANDLER_FILE_NAMES = ['handler.ts', 'handler.js', 'index.ts', 'index.js'];

export type ToolHandler = (input: Record<string, unknown>, context: ToolHandlerContext) => Promise<unknown>;

export class ToolLoader {
  private globalDir: string;
  private projectDir: string;
  private bundledDir: string;
  private tools: Map<string, SquireTool> = new Map();
  private handlers: Map<string, ToolHandler> = new Map();

  constructor(options: ToolLoaderOptions = {}) {
    this.globalDir = options.globalDir || path.join(os.homedir(), '.squire', 'tools');
    this.projectDir = options.projectDir || path.join(process.cwd(), '.squire', 'tools');
    this.bundledDir = options.bundledDir || path.join(__dirname, 'bundled');
  }

  /**
   * Load all tools from all sources
   */
  async loadAll(): Promise<SquireTool[]> {
    this.tools.clear();

    // Load in priority order (lowest to highest, so higher overwrites)
    await this.loadFromDirectory(this.bundledDir, 'bundled');
    await this.loadFromDirectory(this.globalDir, 'global');
    await this.loadFromDirectory(this.projectDir, 'project');

    return Array.from(this.tools.values());
  }

  /**
   * Load a single tool by name
   */
  async load(toolName: string): Promise<SquireTool | null> {
    // Try in priority order (project > global > bundled)
    const sources = [
      { dir: this.projectDir, type: 'project' as const },
      { dir: this.globalDir, type: 'global' as const },
      { dir: this.bundledDir, type: 'bundled' as const },
    ];

    for (const source of sources) {
      const tool = await this.loadFromPath(path.join(source.dir, toolName), source.type);
      if (tool) {
        return tool;
      }
    }

    return null;
  }

  /**
   * Get all loaded tools
   */
  getLoaded(): SquireTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get a loaded tool by name
   */
  get(name: string): SquireTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get the handler for a tool
   */
  getHandler(name: string): ToolHandler | undefined {
    return this.handlers.get(name);
  }

  /**
   * Execute a tool's handler
   */
  async execute(
    toolName: string,
    input: Record<string, unknown>,
    context: ToolHandlerContext
  ): Promise<unknown> {
    const handler = this.handlers.get(toolName);
    if (!handler) {
      throw new Error(`Tool handler not found: ${toolName}`);
    }

    return handler(input, context);
  }

  /**
   * Check if a tool is loaded
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get tools directory paths
   */
  getDirectories(): { global: string; project: string; bundled: string } {
    return {
      global: this.globalDir,
      project: this.projectDir,
      bundled: this.bundledDir,
    };
  }

  /**
   * Load tools from a directory
   */
  private async loadFromDirectory(dir: string, source: 'global' | 'project' | 'bundled'): Promise<void> {
    if (!fs.existsSync(dir)) {
      return;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const toolDir = path.join(dir, entry.name);
      await this.loadFromPath(toolDir, source);
    }
  }

  /**
   * Load a tool from a specific path
   */
  private async loadFromPath(toolDir: string, source: 'global' | 'project' | 'bundled'): Promise<SquireTool | null> {
    if (!fs.existsSync(toolDir)) {
      return null;
    }

    // Find tool.md file
    let toolFile: string | null = null;
    for (const name of TOOL_FILE_NAMES) {
      const filePath = path.join(toolDir, name);
      if (fs.existsSync(filePath)) {
        toolFile = filePath;
        break;
      }
    }

    if (!toolFile) {
      return null;
    }

    try {
      const content = fs.readFileSync(toolFile, 'utf-8');
      const { frontmatter, content: body } = parseToolFrontmatter(content);

      // Validate frontmatter
      const errors = validateToolFrontmatter(frontmatter);
      if (errors.length > 0) {
        console.warn(`[Tools] Validation errors for ${toolDir}:`, errors);
      }

      const name = frontmatter.name || extractToolName(toolDir);

      // Check eligibility
      const eligibility = this.checkEligibility(frontmatter);

      const tool: SquireTool = {
        name,
        description: frontmatter.description,
        path: toolDir,
        source,
        frontmatter,
        eligible: eligibility.eligible,
        eligibilityReason: eligibility.reason,
      };

      // Try to load the handler
      await this.loadHandler(toolDir, name);

      // Add to map (overwrites if same name from lower priority source)
      this.tools.set(name, tool);

      return tool;
    } catch (error) {
      console.error(`[Tools] Failed to load tool from ${toolDir}:`, error);
      return null;
    }
  }

  /**
   * Load a tool's handler
   */
  private async loadHandler(toolDir: string, toolName: string): Promise<void> {
    // Find handler file
    let handlerFile: string | null = null;
    for (const name of HANDLER_FILE_NAMES) {
      const filePath = path.join(toolDir, name);
      if (fs.existsSync(filePath)) {
        handlerFile = filePath;
        break;
      }
    }

    if (!handlerFile) {
      // No handler file - tool might be documentation-only or have a different handler mechanism
      return;
    }

    try {
      // Dynamic import
      const module = await import(handlerFile);
      const handler = module.default || module.handler;

      if (typeof handler === 'function') {
        this.handlers.set(toolName, handler);
      }
    } catch (error) {
      console.warn(`[Tools] Failed to load handler for ${toolName}:`, error);
    }
  }

  /**
   * Check tool eligibility based on requirements
   */
  private checkEligibility(frontmatter: ToolFrontmatter): { eligible: boolean; reason?: string } {
    const requires = frontmatter.metadata?.squire?.requires;

    if (!requires) {
      return { eligible: true };
    }

    // Check required binaries
    if (requires.bins) {
      for (const bin of requires.bins) {
        if (!this.isBinaryAvailable(bin)) {
          return {
            eligible: false,
            reason: `Missing required binary: ${bin}`,
          };
        }
      }
    }

    // Check required environment variables
    if (requires.env) {
      for (const envVar of requires.env) {
        if (!process.env[envVar]) {
          return {
            eligible: false,
            reason: `Missing required environment variable: ${envVar}`,
          };
        }
      }
    }

    return { eligible: true };
  }

  /**
   * Check if a binary is available in PATH
   */
  private isBinaryAvailable(bin: string): boolean {
    try {
      const result = require('child_process').spawnSync('which', [bin], { timeout: 5000 });
      return result.status === 0;
    } catch {
      return false;
    }
  }
}

/**
 * Create a tool loader instance
 */
export function createToolLoader(options?: ToolLoaderOptions): ToolLoader {
  return new ToolLoader(options);
}
