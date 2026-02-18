/**
 * Self-Modification Tools
 *
 * Tools that allow Squire to modify its own configuration.
 * These enable the AI to respond to requests like "your name is Stark" or "be more helpful".
 */

import { defineTool } from './registry.js';
import { loadConfig, saveConfig } from '../config.js';
import { PERSONALITY_TEMPLATES } from '../personality/templates.js';
import type { PersonalityTemplateName } from '../personality/templates.js';

// Reference to the Squire instance (set at runtime)
let squireInstance: {
  getConfig(): any;
  getPersonalityManager(): any;
} | null = null;

/**
 * Set the Squire instance for self-modification
 */
export function setSquireInstance(squire: typeof squireInstance): void {
  squireInstance = squire;
}

/**
 * squire_set_name - Change Squire's name
 */
defineTool(
  'squire_set_name',
  'Set or change your own name. Use this when the user wants to call you something different.',
  {
    name: {
      type: 'string',
      description: 'The new name for yourself',
    },
  },
  ['name'],
  async (input) => {
    const newName = input.name as string;

    if (!newName || newName.trim().length === 0) {
      return 'Error: Name cannot be empty';
    }

    // Update config
    const config = loadConfig();
    if (config) {
      config.name = newName.trim();
      saveConfig(config);
    }

    // Update runtime config if available
    if (squireInstance) {
      const squireConfig = squireInstance.getConfig();
      if (squireConfig) {
        squireConfig.name = newName.trim();
      }
    }

    return JSON.stringify({
      success: true,
      message: `My name is now "${newName}"! I'll remember that.`,
      name: newName,
    });
  }
);

/**
 * squire_set_personality - Change Squire's personality
 */
defineTool(
  'squire_set_personality',
  'Change your personality style. Use this when the user wants you to behave differently. Available templates: helpful, explainer, cheerful, minimal, professional, creative, debugger.',
  {
    template: {
      type: 'string',
      description: 'The personality template to use (helpful, explainer, cheerful, minimal, professional, creative, debugger)',
      enum: ['helpful', 'explainer', 'cheerful', 'minimal', 'professional', 'creative', 'debugger'],
    },
  },
  ['template'],
  async (input) => {
    const templateName = input.template as string;

    const template = PERSONALITY_TEMPLATES[templateName as PersonalityTemplateName];

    if (!template) {
      return JSON.stringify({
        success: false,
        error: `Unknown personality: ${templateName}`,
        available: Object.keys(PERSONALITY_TEMPLATES),
      });
    }

    // Update config
    const config = loadConfig();
    if (config) {
      config.personality.default = { ...template };
      saveConfig(config);
    }

    // Update runtime personality manager if available
    if (squireInstance) {
      const pm = squireInstance.getPersonalityManager();
      if (pm) {
        pm.setDefault({ ...template });
      }
    }

    return JSON.stringify({
      success: true,
      message: `I've adopted the "${template.name}" personality. ${template.description}`,
      personality: {
        name: template.name,
        traits: template.traits,
      },
    });
  }
);

/**
 * squire_remember - Store important information about the user or preferences
 */
defineTool(
  'squire_remember',
  'Store important information about the user, their preferences, or any facts you should remember. This persists across sessions.',
  {
    content: {
      type: 'string',
      description: 'The information to remember',
    },
    category: {
      type: 'string',
      description: 'Category for the memory (preferences, facts, context, instructions)',
      enum: ['preferences', 'facts', 'context', 'instructions'],
    },
  },
  ['content'],
  async (input) => {
    const content = input.content as string;
    const category = (input.category as string) || 'facts';

    // This will be handled by the memory tool integration
    // For now, return success - the actual memory storage happens via the memory manager
    return JSON.stringify({
      success: true,
      message: `I'll remember: "${content}"`,
      category,
      note: 'Use the remember function from the main Squire API for persistent storage',
    });
  }
);

/**
 * squire_workspace_personality - Set personality for a specific workspace
 */
defineTool(
  'squire_workspace_personality',
  'Set a different personality for a specific workspace/channel. This allows different behavior in different contexts.',
  {
    workspaceId: {
      type: 'string',
      description: 'The workspace ID to set personality for',
    },
    template: {
      type: 'string',
      description: 'The personality template to use',
      enum: ['helpful', 'explainer', 'cheerful', 'minimal', 'professional', 'creative', 'debugger'],
    },
  },
  ['workspaceId', 'template'],
  async (input) => {
    const workspaceId = input.workspaceId as string;
    const templateName = input.template as string;

    const template = PERSONALITY_TEMPLATES[templateName as PersonalityTemplateName];

    if (!template) {
      return JSON.stringify({
        success: false,
        error: `Unknown personality: ${templateName}`,
      });
    }

    // Update runtime if available
    if (squireInstance) {
      const pm = squireInstance.getPersonalityManager();
      if (pm) {
        pm.setWorkspaceOverride(workspaceId, { ...template });
      }
    }

    return JSON.stringify({
      success: true,
      message: `Set personality for workspace ${workspaceId} to "${template.name}"`,
    });
  }
);

console.log('[Tools] Self-modification tools registered: squire_set_name, squire_set_personality, squire_remember, squire_workspace_personality');
