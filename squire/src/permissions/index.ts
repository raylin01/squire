/**
 * Squire Permissions
 *
 * Minimal permission system designed for autonomous operation.
 */

export * from './safe-tools.js';

export type { PermissionMode } from './safe-tools.js';
export {
  checkBashPermission,
  checkToolPermission,
  isDangerousCommand,
  getDangerousReason,
} from './safe-tools.js';
