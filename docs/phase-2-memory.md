# Phase 2: Memory System with QMD

**Goal:** Integrate QMD for local embeddings and vector search for persistent memory.

## Overview

We use [QMD](https://github.com/tobi/qmd) as our memory backend instead of building a custom implementation. QMD provides:

- **Local embeddings** via node-llama-cpp (no API calls, fully private)
- **Vector search** via sqlite-vec extension
- **Hybrid search** combining vector similarity + BM25 full-text search
- **LLM-powered query expansion** for better recall
- **LLM reranking** with qwen3-reranker for precision
- **Built-in MCP server** for direct AI tool access
- **Smart markdown chunking** for document storage

## Why QMD Instead of Custom?

| Feature | Custom (phase-2 original) | QMD |
|---------|---------------------------|-----|
| Embeddings | ✅ node-llama-cpp | ✅ node-llama-cpp |
| Vector DB | ✅ sqlite-vec | ✅ sqlite-vec |
| FTS | ✅ FTS5 | ✅ FTS5 + BM25 |
| Query expansion | ❌ | ✅ LLM-powered |
| Reranking | ❌ | ✅ qwen3-reranker |
| Position blending | ❌ | ✅ Hybrid scoring |
| Smart chunking | ❌ | ✅ Markdown-aware |
| MCP server | Need to build | ✅ Built-in |
| Maintenance | Our responsibility | Community maintained |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     SQUIRE INSTANCE                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                   MEMORY WRAPPER                             ││
│  │  - Thin abstraction over QMD MCP tools                       ││
│  │  - Workspace-scoped queries                                  ││
│  │  - Squire-specific metadata                                  ││
│  └─────────────────────────────────────────────────────────────┘│
│                          │                                       │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                      QMD MCP SERVER                          ││
│  │  Tools: qmd_remember, qmd_recall, qmd_forget, qmd_reflect    ││
│  │  - Query expansion via LLM                                   ││
│  │  - Hybrid vector + BM25 search                               ││
│  │  - LLM reranking for precision                               ││
│  └─────────────────────────────────────────────────────────────┘│
│                          │                                       │
│                          ▼                                       │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    SQLITE + SQLITE-VEC                       ││
│  │  - memories (id, content, embedding, metadata)               ││
│  │  - FTS5 virtual tables for BM25                              ││
│  │  - embeddinggemma-300M for 256-dim vectors                   ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Files to Create

```
squire/src/memory/
├── manager.ts              # Thin wrapper around QMD MCP
├── types.ts                # Memory-specific types (re-export from main)
└── index.ts                # Public API exports
```

## Installation

### 1. Install QMD

QMD needs to be installed and available on the system:

```bash
# Via npm (recommended)
npm install -g @tobilu/qmd

# Or clone and build
git clone https://github.com/tobi/qmd.git
cd qmd && npm install && npm run build
```

### 2. Configure QMD

Create `~/.squire/qmd-config.json`:

```json
{
  "dataDir": "~/.squire/data/qmd",
  "embeddingModel": "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf",
  "rerankerModel": "hf:ggml-org/qwen3-reranker-GGUF/qwen3-reranker-Q8_0.gguf",
  "contextWindow": 512,
  "enableReranking": true
}
```

### 3. Start QMD MCP Server

QMD runs as an MCP server that Squire connects to:

```bash
qmd serve --port 3000 --config ~/.squire/qmd-config.json
```

## Memory Manager (manager.ts)

Thin wrapper around QMD MCP tools with Squire-specific functionality:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { MemoryEntry, MemorySearchResult, MemoryConfig } from '../types.js';

export class MemoryManager {
  private config: MemoryConfig;
  private mcpClient: Client | null = null;
  private dataDir: string;

  constructor(config: MemoryConfig, dataDir: string) {
    this.config = config;
    this.dataDir = dataDir;
  }

  async initialize(): Promise<void> {
    // Connect to QMD MCP server
    this.mcpClient = new Client(
      { name: 'squire-memory', version: '1.0.0' },
      { capabilities: {} }
    );

    const transport = new StdioClientTransport({
      command: 'qmd',
      args: ['serve', '--stdio', '--data-dir', this.dataDir]
    });

    await this.mcpClient.connect(transport);
    console.log('[Memory] Connected to QMD');
  }

  async add(
    content: string,
    options?: {
      source?: MemoryEntry['source'];
      workspaceId?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<MemoryEntry> {
    const metadata = {
      ...options?.metadata,
      source: options?.source || 'user',
      workspaceId: options?.workspaceId,
    };

    const result = await this.mcpClient!.callTool({
      name: 'qmd_remember',
      arguments: {
        content,
        metadata
      }
    });

    const id = (result.content as any[]).find(c => c.type === 'text')?.text;

    return {
      id,
      content,
      source: options?.source || 'user',
      workspaceId: options?.workspaceId,
      metadata: metadata as Record<string, unknown>,
      createdAt: new Date().toISOString(),
    };
  }

  async search(
    query: string,
    options?: {
      limit?: number;
      workspaceId?: string;
      source?: string;
    }
  ): Promise<MemorySearchResult[]> {
    const result = await this.mcpClient!.callTool({
      name: 'qmd_recall',
      arguments: {
        query,
        limit: options?.limit || 10,
        filter: options?.workspaceId
          ? { workspaceId: options.workspaceId }
          : undefined
      }
    });

    const text = (result.content as any[]).find(c => c.type === 'text')?.text;
    const results = JSON.parse(text || '[]');

    return results.map((r: any) => ({
      entry: {
        id: r.id,
        content: r.content,
        source: r.metadata?.source || 'user',
        workspaceId: r.metadata?.workspaceId,
        metadata: r.metadata || {},
        createdAt: r.createdAt,
        score: r.score
      },
      score: r.score
    }));
  }

  async forget(query: string, limit?: number): Promise<number> {
    const result = await this.mcpClient!.callTool({
      name: 'qmd_forget',
      arguments: {
        query,
        limit: limit || 10
      }
    });

    const text = (result.content as any[]).find(c => c.type === 'text')?.text;
    return parseInt(text || '0', 10);
  }

  async reflect(): Promise<void> {
    await this.mcpClient!.callTool({
      name: 'qmd_reflect',
      arguments: {}
    });
  }

  async close(): Promise<void> {
    if (this.mcpClient) {
      await this.mcpClient.close();
      this.mcpClient = null;
    }
  }
}
```

## Memory Tools for Agent

These MCP-like tools are provided by QMD directly. Squire passes them through:

| Tool | Description |
|------|-------------|
| `qmd_remember` | Store content with automatic embedding |
| `qmd_recall` | Hybrid search with query expansion + reranking |
| `qmd_forget` | Remove memories matching a query |
| `qmd_reflect` | Summarize and consolidate old memories |

### Tool Schemas

```typescript
// qmd_remember
{
  name: 'qmd_remember',
  description: 'Store a fact or piece of information in long-term memory',
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The information to remember' },
      metadata: { type: 'object', description: 'Optional metadata' }
    },
    required: ['content']
  }
}

// qmd_recall
{
  name: 'qmd_recall',
  description: 'Search memories using hybrid vector + BM25 search with LLM reranking',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to search for' },
      limit: { type: 'number', description: 'Max results', default: 10 },
      filter: { type: 'object', description: 'Metadata filters' }
    },
    required: ['query']
  }
}

// qmd_forget
{
  name: 'qmd_forget',
  description: 'Remove memories matching a query',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Which memories to forget' },
      limit: { type: 'number', description: 'Max to delete', default: 10 }
    },
    required: ['query']
  }
}

// qmd_reflect
{
  name: 'qmd_reflect',
  description: 'Summarize and consolidate old memories to save space',
  inputSchema: {
    type: 'object',
    properties: {}
  }
}
```

## Dependencies

Update `squire/package.json`:

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "peerDependencies": {
    "@tobilu/qmd": ">=1.0.0"
  },
  "optionalDependencies": {
    "@tobilu/qmd": "^1.0.0"
  }
}
```

**Note:** QMD itself needs to be installed separately as it includes native modules (node-llama-cpp, better-sqlite3 with sqlite-vec).

## Configuration Updates

Update `squire/src/types.ts`:

```typescript
export interface MemoryConfig {
  enabled: boolean;
  provider: 'qmd' | 'openai' | 'voyage';  // 'qmd' is now default
  qmdPath?: string;  // Path to qmd binary, defaults to 'qmd' in PATH
  dataDir?: string;  // QMD data directory
  enableReranking?: boolean;  // Enable LLM reranking
  retentionDays: number;
}
```

Update `squire/src/config.ts` defaults:

```typescript
const DEFAULT_CONFIG = {
  // ...
  memory: {
    enabled: true,
    provider: 'qmd',
    enableReranking: true,
    retentionDays: 90,
  },
  // ...
};
```

## Testing

```typescript
import { test } from 'node:test';
import assert from 'node:assert';
import { MemoryManager } from '../dist/memory/manager.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

test('Memory stores and retrieves via QMD', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squire-test-'));

  const memory = new MemoryManager({
    enabled: true,
    provider: 'qmd',
    retentionDays: 30
  }, tempDir);

  await memory.initialize();

  // Store
  const entry = await memory.add('User prefers dark mode in all applications', {
    source: 'user',
    workspaceId: 'test-workspace'
  });
  assert.ok(entry.id);

  // Retrieve
  const results = await memory.search('UI preferences', { limit: 5 });
  assert.ok(results.length > 0);
  assert.ok(results[0].entry.content.includes('dark mode'));

  await memory.close();
  fs.rmSync(tempDir, { recursive: true });
});

test('QMD reranking improves relevance', async () => {
  // Test that reranking returns more relevant results
  // than pure vector similarity
});
```

## Integration with Squire

In `squire/src/squire.ts`:

```typescript
export class Squire implements SquireInterface {
  private memory: MemoryManager | null = null;

  async start(): Promise<void> {
    if (this.config.memory.enabled) {
      this.memory = new MemoryManager(
        this.config.memory,
        this.config.dataDir
      );
      await this.memory.initialize();
    }
    // ...
  }

  async remember(content: string, options?: RememberOptions): Promise<MemoryEntry> {
    if (!this.memory) {
      throw new Error('Memory not enabled');
    }
    return this.memory.add(content, options);
  }

  async recall(query: string, limit?: number): Promise<MemorySearchResult[]> {
    if (!this.memory) {
      throw new Error('Memory not enabled');
    }
    return this.memory.search(query, { limit });
  }
}
```

## Next Phase

- **Phase 3**: Skills system with YAML frontmatter
