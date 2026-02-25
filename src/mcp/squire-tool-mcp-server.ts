import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { SDKTool } from '../sdk/types.js';

interface BridgeResponseSuccess {
  ok: true;
  result: unknown;
}

interface BridgeResponseError {
  ok: false;
  error: string;
}

type BridgeResponse = BridgeResponseSuccess | BridgeResponseError;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseToolDefinitions(raw: string): SDKTool[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse SQUIRE_TOOL_DEFINITIONS_JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('SQUIRE_TOOL_DEFINITIONS_JSON must be an array.');
  }

  return parsed
    .filter((item): item is SDKTool => {
      if (!item || typeof item !== 'object') return false;
      const candidate = item as SDKTool;
      return typeof candidate.name === 'string'
        && typeof candidate.description === 'string'
        && !!candidate.inputSchema
        && candidate.inputSchema.type === 'object';
    })
    .map((tool) => ({
      ...tool,
      inputSchema: {
        type: 'object',
        properties: tool.inputSchema.properties || {},
        required: tool.inputSchema.required || [],
      },
    }));
}

function stringifyToolResult(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function executeViaBridge(
  bridgeUrl: string,
  bridgeToken: string,
  workspaceId: string | undefined,
  toolName: string,
  input: Record<string, unknown>
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(`${bridgeUrl}/execute`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${bridgeToken}`,
      },
      body: JSON.stringify({
        toolName,
        input,
        workspaceId,
      }),
      signal: controller.signal,
    });

    let payload: BridgeResponse | null = null;
    try {
      payload = await response.json() as BridgeResponse;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const message = payload && !payload.ok && payload.error
        ? payload.error
        : `Bridge request failed (${response.status})`;
      throw new Error(message);
    }

    if (!payload || !payload.ok) {
      const message = payload && !payload.ok && payload.error
        ? payload.error
        : 'Bridge returned an invalid response.';
      throw new Error(message);
    }

    return payload.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  const bridgeUrl = requireEnv('SQUIRE_TOOL_BRIDGE_URL');
  const bridgeToken = requireEnv('SQUIRE_TOOL_BRIDGE_TOKEN');
  const workspaceId = process.env.SQUIRE_TOOL_WORKSPACE_ID;
  const tools = parseToolDefinitions(requireEnv('SQUIRE_TOOL_DEFINITIONS_JSON'));
  const toolSet = new Set(tools.map((tool) => tool.name));

  const server = new Server(
    {
      name: 'squire-tool-mcp-server',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: {
        type: 'object',
        properties: tool.inputSchema.properties || {},
        required: tool.inputSchema.required || [],
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const toolInput = (request.params.arguments || {}) as Record<string, unknown>;

    if (!toolSet.has(toolName)) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${toolName}`);
    }

    try {
      const result = await executeViaBridge(
        bridgeUrl,
        bridgeToken,
        workspaceId,
        toolName,
        toolInput
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: stringifyToolResult(result),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: `Error: ${message}`,
          },
        ],
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`[squire-tool-mcp-server] ${message}\n`);
  process.exit(1);
});
