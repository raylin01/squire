/**
 * Squire Memory Tools
 *
 * Enhanced tools for the hybrid memory system with hand-holding guidance.
 * Helps AI understand when and how to use different memory types.
 */

import { defineTool } from './index.js';
import type { HybridMemoryManager } from '../memory/hybrid-manager.js';

let memoryManager: HybridMemoryManager | null = null;

/**
 * Set the memory manager for the tools to use.
 */
export function setMemoryManager(manager: HybridMemoryManager): void {
  memoryManager = manager;
}

/**
 * Get the memory manager
 */
function getManager(): HybridMemoryManager {
  if (!memoryManager) {
    throw new Error('Memory system not initialized');
  }
  return memoryManager;
}

// ============================================================================
// Core Memory Tools - For long-term curated information
// ============================================================================

/**
 * Remember a user preference
 */
defineTool(
  'memory_remember_preference',
  `Remember a user preference for future interactions.

WHEN TO USE:
- User explicitly states a preference ("I prefer TypeScript")
- User expresses a like or dislike
- User makes a consistent choice repeatedly

EXAMPLES:
- "prefers TypeScript over JavaScript"
- "likes dark mode interfaces"
- "wants concise responses without emojis"`,
  {
    preference: {
      type: 'string',
      description: 'The preference to remember (start with verb: prefers, likes, wants, dislikes)',
    },
    evidence: {
      type: 'string',
      description: 'Optional: Why you think this is their preference',
    },
  },
  ['preference'],
  async (input) => {
    const manager = getManager();
    const entry = await manager.recordPreference(input.preference as string, {
      evidence: input.evidence as string | undefined,
    });
    return JSON.stringify({
      success: true,
      message: `Remembered: "${input.preference}"`,
      type: 'preference',
      id: entry.id,
    }, null, 2);
  }
);

/**
 * Remember a fact about the user
 */
defineTool(
  'memory_remember_fact',
  `Remember a fact about the user.

WHEN TO USE:
- User mentions where they work
- User mentions a project they own
- User mentions their timezone, location, schedule
- Any objective fact that won't change often

EXAMPLES:
- "Works at Acme Corp"
- "Main project is DisCode"
- "Located in PST timezone"`,
  {
    fact: {
      type: 'string',
      description: 'The fact to remember',
    },
  },
  ['fact'],
  async (input) => {
    const manager = getManager();
    const entry = await manager.recordFact(input.fact as string);
    return JSON.stringify({
      success: true,
      message: `Remembered: "${input.fact}"`,
      type: 'fact',
      id: entry.id,
    }, null, 2);
  }
);

/**
 * Record a decision with rationale
 */
defineTool(
  'memory_record_decision',
  `Record an important decision and why it was made.

WHEN TO USE:
- User makes a significant architectural choice
- User chooses between alternatives
- A decision that might be questioned later

EXAMPLES:
- Decision: "Use WebSocket for real-time sync"
- Rationale: "Better UX than polling, lower latency"`,
  {
    decision: {
      type: 'string',
      description: 'The decision made',
    },
    rationale: {
      type: 'string',
      description: 'Why this decision was made',
    },
  },
  ['decision', 'rationale'],
  async (input) => {
    const manager = getManager();
    const entry = await manager.recordDecision(
      input.decision as string,
      input.rationale as string
    );
    return JSON.stringify({
      success: true,
      message: `Recorded decision: "${input.decision}"`,
      type: 'decision',
      id: entry.id,
    }, null, 2);
  }
);

/**
 * Record a learned pattern
 */
defineTool(
  'memory_record_pattern',
  `Record a pattern you noticed about the user.

WHEN TO USE:
- You observe consistent behavior
- You notice work habits
- You identify preferences from actions, not words

EXAMPLES:
- "Codes late at night (after 10pm)"
- "Prefers to review changes before committing"
- "Usually works on weekends"`,
  {
    pattern: {
      type: 'string',
      description: 'The pattern observed',
    },
    confidence: {
      type: 'number',
      description: 'How confident you are (0-1, default 0.7)',
    },
  },
  ['pattern'],
  async (input) => {
    const manager = getManager();
    const entry = await manager.recordPattern(input.pattern as string, {
      confidence: input.confidence as number | undefined,
    });
    return JSON.stringify({
      success: true,
      message: `Recorded pattern: "${input.pattern}"`,
      type: 'pattern',
      confidence: entry.confidence,
      id: entry.id,
    }, null, 2);
  }
);

// ============================================================================
// Daily Log Tools - For day-based activity tracking
// ============================================================================

/**
 * Record a commit
 */
defineTool(
  'memory_record_commit',
  `Record a git commit in today's log.

WHEN TO USE:
- After making a git commit
- To track daily progress
- For generating daily summaries`,
  {
    sha: {
      type: 'string',
      description: 'The commit SHA (first 7 chars is fine)',
    },
    message: {
      type: 'string',
      description: 'The commit message',
    },
    files: {
      type: 'string',
      description: 'Comma-separated list of files changed',
    },
    project: {
      type: 'string',
      description: 'Project name',
    },
  },
  ['sha', 'message'],
  async (input) => {
    const manager = getManager();
    const filesStr = input.files as string | undefined;
    const files = filesStr ? filesStr.split(',').map(f => f.trim()) : [];
    const entry = await manager.recordCommit(
      input.sha as string,
      input.message as string,
      files,
      undefined,
      input.project as string | undefined
    );
    return JSON.stringify({
      success: true,
      message: `Recorded commit: ${input.sha}`,
      id: entry.id,
    }, null, 2);
  }
);

/**
 * Record a task
 */
defineTool(
  'memory_record_task',
  `Record task progress in today's log.

WHEN TO USE:
- Starting a significant task
- Completing a task
- Getting blocked on a task`,
  {
    task: {
      type: 'string',
      description: 'The task name or description',
    },
    status: {
      type: 'string',
      enum: ['started', 'completed', 'blocked'],
      description: 'Current status',
    },
  },
  ['task', 'status'],
  async (input) => {
    const manager = getManager();
    const entry = await manager.recordTask(
      input.task as string,
      input.status as 'started' | 'completed' | 'blocked'
    );
    return JSON.stringify({
      success: true,
      message: `Task "${input.task}" marked as ${input.status}`,
      id: entry.id,
    }, null, 2);
  }
);

/**
 * Record a learning
 */
defineTool(
  'memory_record_learning',
  `Record something learned today.

WHEN TO USE:
- You or the user discovers something new
- An insight that might be useful later
- A pattern or technique learned`,
  {
    learning: {
      type: 'string',
      description: 'What was learned',
    },
  },
  ['learning'],
  async (input) => {
    const manager = getManager();
    const entry = await manager.recordLearning(input.learning as string);
    return JSON.stringify({
      success: true,
      message: `Recorded learning: "${input.learning}"`,
      id: entry.id,
    }, null, 2);
  }
);

/**
 * Add a note to today's log
 */
defineTool(
  'memory_add_note',
  `Add a general note to today's log.

WHEN TO USE:
- Something worth noting happened
- A discussion point to remember
- Context for future reference`,
  {
    note: {
      type: 'string',
      description: 'The note to add',
    },
  },
  ['note'],
  async (input) => {
    const manager = getManager();
    const entry = await manager.addDailyNote(input.note as string);
    return JSON.stringify({
      success: true,
      message: `Added note: "${input.note}"`,
      id: entry.id,
    }, null, 2);
  }
);

// ============================================================================
// Query Tools - For retrieving memories
// ============================================================================

/**
 * Search all memory
 */
defineTool(
  'memory_search',
  `Search across all memory (preferences, facts, decisions, daily logs).

WHEN TO USE:
- User asks "do you remember..."
- User asks about past decisions
- User asks about their preferences
- You need context from previous conversations`,
  {
    query: {
      type: 'string',
      description: 'What to search for',
    },
    limit: {
      type: 'number',
      description: 'Max results (default: 5)',
    },
  },
  ['query'],
  async (input) => {
    const manager = getManager();
    const results = await manager.search(input.query as string, {
      limit: (input.limit as number) || 5,
    });

    if (results.length === 0) {
      return JSON.stringify({
        success: true,
        message: 'No memories found',
        results: [],
      }, null, 2);
    }

    return JSON.stringify({
      success: true,
      count: results.length,
      results: results.map(r => {
        const entry = r.entry;
        return {
          content: entry.content || '',
          type: entry.metadata?.type || 'unknown',
          score: Math.round(r.score * 100) / 100,
        };
      }),
    }, null, 2);
  }
);

/**
 * Get memory overview
 */
defineTool(
  'memory_overview',
  `Get an overview of stored memories.

WHEN TO USE:
- User asks "what do you know about me?"
- Start of a new session to review context
- When you want to see what's in memory`,
  {},
  [],
  async () => {
    const manager = getManager();

    // Get core memory overview
    const coreOverview = manager.getCoreMemoryOverview();

    // Get recent activity
    const recent = await manager.getRecentActivity(7);

    const lines = [
      coreOverview,
      '',
      '**Recent Activity (7 days):**',
      `  - Commits: ${recent.totalCommits}`,
      `  - Tasks Completed: ${recent.totalTasks}`,
      `  - Active Projects: ${recent.activeWorkspaces.join(', ') || 'none'}`,
    ];

    if (recent.highlights.length > 0) {
      lines.push('', '**Highlights:**');
      for (const h of recent.highlights.slice(0, 5)) {
        lines.push(`  - ${h}`);
      }
    }

    return JSON.stringify({
      success: true,
      overview: lines.join('\n'),
    }, null, 2);
  }
);

/**
 * Generate today's summary
 */
defineTool(
  'memory_daily_summary',
  `Generate a summary of today's activity.

WHEN TO USE:
- End of a session
- User asks "what did we do today?"
- For daily standup/report`,
  {},
  [],
  async () => {
    const manager = getManager();
    const summary = await manager.generateDailySummary();
    return JSON.stringify({
      success: true,
      summary,
    }, null, 2);
  }
);

/**
 * Reflect on memory (QMD consolidation)
 */
defineTool(
  'memory_reflect',
  `Trigger memory consolidation and organization.

WHEN TO USE:
- End of a significant session
- Periodically to optimize memory
- Before important searches`,
  {},
  [],
  async () => {
    const manager = getManager();
    await manager.reflect();
    return JSON.stringify({
      success: true,
      message: 'Memory reflection completed',
    }, null, 2);
  }
);

console.log('[MemoryTools] Registered enhanced memory tools with hand-holding');
