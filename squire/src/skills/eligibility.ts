/**
 * Eligibility Checker
 *
 * Checks if a skill is eligible to run on the current platform/environment.
 */

import { execSync } from 'child_process';
import process from 'process';
import type { SkillFrontmatter } from '../types.js';

export interface EligibilityResult {
  eligible: boolean;
  reason?: string;
  missingBins: string[];
  missingEnv: string[];
}

export function checkEligibility(frontmatter: SkillFrontmatter): EligibilityResult {
  const requires = frontmatter.metadata?.squire?.requires;

  if (!requires) {
    return { eligible: true, missingBins: [], missingEnv: [] };
  }

  const missingBins: string[] = [];
  const missingEnv: string[] = [];

  // Check required binaries
  if (requires.bins) {
    for (const bin of requires.bins) {
      if (!isBinaryAvailable(bin)) {
        missingBins.push(bin);
      }
    }
  }

  // Check required environment variables
  if (requires.env) {
    for (const envVar of requires.env) {
      if (!process.env[envVar]) {
        missingEnv.push(envVar);
      }
    }
  }

  const eligible = missingBins.length === 0 && missingEnv.length === 0;

  return {
    eligible,
    reason: eligible ? undefined : `Missing: bins=[${missingBins.join(', ')}] env=[${missingEnv.join(', ')}]`,
    missingBins,
    missingEnv,
  };
}

export function isBinaryAvailable(binary: string): boolean {
  try {
    execSync(`which ${binary}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function getPlatform(): 'darwin' | 'linux' | 'windows' | 'unknown' {
  switch (process.platform) {
    case 'darwin':
      return 'darwin';
    case 'linux':
      return 'linux';
    case 'win32':
      return 'windows';
    default:
      return 'unknown';
  }
}

export function isMacOS(): boolean {
  return process.platform === 'darwin';
}

export function isLinux(): boolean {
  return process.platform === 'linux';
}

export function isWindows(): boolean {
  return process.platform === 'win32';
}
