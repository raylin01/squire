/**
 * Squire SDK Types
 *
 * Type definitions for the SDK abstraction layer.
 */

// ============================================================================
// SDK Provider Types
// ============================================================================

export type SDKProvider = 'claude' | 'gemini' | 'codex';

export type PermissionMode = 'strict' | 'autoSafe' | 'permissive';

// ============================================================================
// SDK Configuration
// ============================================================================

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  type?: 'stdio' | 'sse' | 'http';
}

export interface NativeToolBridgeConfig {
  serverName: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface SDKConfig {
  /** Which SDK provider to use */
  provider: SDKProvider;

  /** Model to use (provider-specific, optional) */
  model?: string;

  /** Working directory for the CLI */
  cwd: string;

  /** Permission mode */
  permissionMode: PermissionMode;

  /** MCP servers to configure */
  mcpServers?: Record<string, MCPServerConfig>;

  /** Native tools exposed to the provider (directly or through MCP bridge) */
  tools?: SDKTool[];

  /** Runtime bridge server configuration for native Squire tools */
  toolBridge?: NativeToolBridgeConfig;

  /** Directory for provider runtime files (generated settings, etc.) */
  runtimeDir?: string;

  /** Environment variables to pass to CLI */
  env?: Record<string, string>;

  /** Custom path to CLI binary */
  cliPath?: string;

  /** Resume an existing session */
  resumeSessionId?: string;

  /** Debug mode */
  debug?: boolean;
}

// ============================================================================
// Message Types
// ============================================================================

export interface SDKImage {
  data: string;
  mediaType: string;
}

export interface SDKMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: SDKImage[];
}

export interface SDKToolResult {
  toolUseId: string;
  content: string;
  isError?: boolean;
}

// ============================================================================
// Event Types
// ============================================================================

export interface ToolUseEvent {
  toolName: string;
  toolId: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent {
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export interface ApprovalEvent {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  context?: string;
  options?: Array<{ label: string; description?: string }>;
}

export interface OutputEvent {
  content: string;
  isComplete: boolean;
  outputType: 'stdout' | 'thinking';
}

export interface MetadataEvent {
  tokens?: number;
  model?: string;
  permissionMode?: string;
  /** CLI session ID for resuming conversations */
  sessionId?: string;
}

// ============================================================================
// Tool Definition
// ============================================================================

export interface SDKTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
    }>;
    required?: string[];
  };
}

// ============================================================================
// Client Status
// ============================================================================

export type ClientStatus = 'idle' | 'working' | 'waiting' | 'offline' | 'error';
