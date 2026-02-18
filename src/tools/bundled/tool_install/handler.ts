/**
 * Tool Install Handler
 *
 * Installs a tool from a git repository.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { ToolHandlerContext } from '../../../types.js';

interface ToolInstallInput {
  repository: string;
  destination?: 'global' | 'project';
  name?: string;
}

export default async function toolInstallHandler(
  input: ToolInstallInput,
  context: ToolHandlerContext
): Promise<{ success: boolean; message: string; path?: string; toolName?: string }> {
  const { repository, destination = 'global', name } = input;

  if (!repository || repository.trim() === '') {
    return {
      success: false,
      message: 'Repository URL is required',
    };
  }

  try {
    // Determine destination directory
    const toolsDir = destination === 'project'
      ? path.join(process.cwd(), '.squire', 'tools')
      : path.join(os.homedir(), '.squire', 'tools');

    // Ensure directory exists
    if (!fs.existsSync(toolsDir)) {
      fs.mkdirSync(toolsDir, { recursive: true });
    }

    // Determine tool name from URL or custom name
    let toolName = name;
    if (!toolName) {
      // Extract name from repository URL
      const urlParts = repository.replace(/\.git$/, '').split('/');
      toolName = urlParts[urlParts.length - 1] || 'unknown-tool';

      // Remove common prefixes
      toolName = toolName.replace(/^squire-tool-/, '').replace(/^tool-/, '');
    }

    // Sanitize tool name
    toolName = toolName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');

    const toolPath = path.join(toolsDir, toolName);

    // Check if tool already exists
    if (fs.existsSync(toolPath)) {
      return {
        success: false,
        message: `Tool "${toolName}" already exists at ${toolPath}. Remove it first or use a different name.`,
      };
    }

    // Clone the repository
    console.log(`[ToolInstall] Cloning ${repository} to ${toolPath}...`);

    execSync(`git clone --depth 1 "${repository}" "${toolPath}"`, {
      stdio: 'pipe',
      timeout: 60000, // 1 minute timeout
    });

    // Verify it has a tool.md file
    const toolMdPath = path.join(toolPath, 'tool.md');
    const toolMdAltPath = path.join(toolPath, 'TOOL.md');

    if (!fs.existsSync(toolMdPath) && !fs.existsSync(toolMdAltPath)) {
      // Clean up - not a valid tool
      fs.rmSync(toolPath, { recursive: true, force: true });
      return {
        success: false,
        message: `Repository does not contain a tool.md file. Not a valid Squire tool.`,
      };
    }

    // Remove .git directory to save space
    const gitDir = path.join(toolPath, '.git');
    if (fs.existsSync(gitDir)) {
      fs.rmSync(gitDir, { recursive: true, force: true });
    }

    return {
      success: true,
      message: `Successfully installed tool "${toolName}" to ${toolPath}`,
      path: toolPath,
      toolName,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Handle common git errors
    if (errorMessage.includes('not found') || errorMessage.includes('404')) {
      return {
        success: false,
        message: `Repository not found: ${repository}`,
      };
    }

    if (errorMessage.includes('git')) {
      return {
        success: false,
        message: `Git error: ${errorMessage}. Make sure git is installed and the repository URL is correct.`,
      };
    }

    return {
      success: false,
      message: `Failed to install tool: ${errorMessage}`,
    };
  }
}
