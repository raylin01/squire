/**
 * Skill Dependency Installer
 *
 * Installs skill dependencies via brew, npm, go, or uv.
 */

import { execSync } from 'child_process';
import type { SkillInstallStep } from '../types.js';
import { isBinaryAvailable } from './eligibility.js';

export interface InstallResult {
  success: boolean;
  step: SkillInstallStep;
  output?: string;
  error?: string;
}

export async function installDependencies(steps: SkillInstallStep[]): Promise<InstallResult[]> {
  const results: InstallResult[] = [];

  for (const step of steps) {
    const result = await installStep(step);
    results.push(result);

    if (!result.success) {
      console.error(`[Skills] Failed to install ${step.package}: ${result.error}`);
      // Continue trying other steps
    }
  }

  return results;
}

async function installStep(step: SkillInstallStep): Promise<InstallResult> {
  const { type, package: pkg, version } = step;

  // Check if already installed (for bins)
  if (isBinaryAvailable(pkg)) {
    console.log(`[Skills] ${pkg} already installed`);
    return { success: true, step };
  }

  let command: string;

  switch (type) {
    case 'brew':
      command = `brew install ${pkg}`;
      break;
    case 'npm':
      command = version
        ? `npm install -g ${pkg}@${version}`
        : `npm install -g ${pkg}`;
      break;
    case 'go':
      command = `go install ${pkg}@${version || 'latest'}`;
      break;
    case 'uv':
      command = `uv pip install ${pkg}${version ? `==${version}` : ''}`;
      break;
    case 'download':
      // Download is handled separately
      return { success: false, step, error: 'Download install type not yet supported' };
    default:
      return { success: false, step, error: `Unknown install type: ${type}` };
  }

  try {
    console.log(`[Skills] Installing ${pkg} via ${type}...`);
    const output = execSync(command, {
      encoding: 'utf-8',
      timeout: 120000, // 2 minutes
    });

    console.log(`[Skills] Successfully installed ${pkg}`);
    return { success: true, step, output };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, step, error: errorMessage };
  }
}

export function canAutoInstall(): boolean {
  // Check if we have any package managers available
  return isBinaryAvailable('brew') ||
         isBinaryAvailable('npm') ||
         isBinaryAvailable('go');
}

export function getAvailablePackageManagers(): string[] {
  const managers: string[] = [];

  if (isBinaryAvailable('brew')) managers.push('brew');
  if (isBinaryAvailable('npm')) managers.push('npm');
  if (isBinaryAvailable('go')) managers.push('go');
  if (isBinaryAvailable('uv')) managers.push('uv');

  return managers;
}
