/**
 * Gemini SDK Client Wrapper
 *
 * Wrapper around @raylin01/gemini-client for use in Squire.
 * NOTE: This is a simplified stub. Full integration requires matching
 * the actual client library API.
 */

import fs from 'fs';
import path from 'path';
import { BaseSDKClient } from './base.js';
import {
  MCPServerConfig,
  SDKConfig,
  SDKMessage,
  SDKToolResult,
  ToolUseEvent,
} from './types.js';

/**
 * Gemini SDK Client
 *
 * Provides a unified interface for the Gemini CLI.
 * Uses @raylin01/gemini-client internally.
 */
export class GeminiSDKClient extends BaseSDKClient {
  readonly provider = 'gemini';
  private client: any = null;
  private supportsResume = true;
  private outputFormat: 'stream-json' | 'json' = 'stream-json';
  private allowedMcpServerNames: string[] = [];

  constructor(config: SDKConfig) {
    super(config);
  }

  async start(): Promise<void> {
    try {
      const { GeminiClient } = await import('@raylin01/gemini-client');
      const approvalMode = this.getApprovalMode();
      const runtime = this.prepareRuntimeEnvironment();
      this.allowedMcpServerNames = runtime.allowedMcpServerNames;

      this.client = new GeminiClient({
        cwd: this.config.cwd || process.cwd(),
        geminiPath: this.config.cliPath,
        env: runtime.env,
        model: this.config.model,
        outputFormat: this.outputFormat,
        approvalMode,
        allowedMcpServerNames: this.allowedMcpServerNames,
      });

      if (
        this.supportsResume &&
        this.config.resumeSessionId &&
        typeof this.client.setSessionId === 'function'
      ) {
        this.client.setSessionId(this.config.resumeSessionId);
      }

      this.setupEventListeners();

      // Actually start the underlying Gemini process
      await this.client.start();

      this.setStatus('idle');
    } catch (error) {
      console.warn('[GeminiSDK] Could not initialize Gemini client:', error);
      this.setStatus('error');
    }
  }

  private getApprovalMode(): 'default' | 'auto_edit' | 'yolo' {
    switch (this.config.permissionMode) {
      case 'permissive':
        return 'yolo';
      case 'autoSafe':
        return 'auto_edit';
      case 'strict':
      default:
        return 'default';
    }
  }

  private buildMergedMcpServers(): Record<string, MCPServerConfig> {
    const merged = { ...(this.config.mcpServers || {}) } as Record<string, MCPServerConfig>;
    if (this.config.toolBridge) {
      merged[this.config.toolBridge.serverName] = {
        command: this.config.toolBridge.command,
        args: this.config.toolBridge.args,
        env: this.config.toolBridge.env,
      };
    }
    return merged;
  }

  private ensureRuntimeDir(): string {
    const fallback = path.join(this.config.cwd || process.cwd(), '.squire', 'runtime', 'gemini');
    const runtimeDir = this.config.runtimeDir || fallback;
    fs.mkdirSync(runtimeDir, { recursive: true });
    return runtimeDir;
  }

  private prepareRuntimeEnvironment(): { env: NodeJS.ProcessEnv; allowedMcpServerNames: string[] } {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.config.env,
    };

    const mergedMcpServers = this.buildMergedMcpServers();
    const allowedMcpServerNames = Object.keys(mergedMcpServers);
    if (allowedMcpServerNames.length === 0) {
      return { env, allowedMcpServerNames };
    }

    const runtimeDir = this.ensureRuntimeDir();
    const settingsPath = path.join(runtimeDir, 'gemini-system-settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ mcpServers: mergedMcpServers }, null, 2), 'utf8');
    env.GEMINI_CLI_SYSTEM_SETTINGS_PATH = settingsPath;

    return { env, allowedMcpServerNames };
  }

  private setupEventListeners(): void {
    if (!this.client) return;

    // Map client events to our unified interface
    this.client.on('ready', (sessionId: string) => {
      this.emit('metadata', {
        sessionId,
        model: this.config.model,
      });
      this.config.resumeSessionId = sessionId;
    });

    this.client.on('message_delta', (delta: string) => {
      this.appendOutput(delta, false);
    });

    this.client.on('tool_use', (event: any) => {
      this.emit('tool_use', {
        toolName: event.tool_name,
        toolId: event.tool_id,
        input: event.parameters,
      } as ToolUseEvent);
    });

    this.client.on('tool_result', (event: any) => {
      this.emit('tool_result', {
        toolUseId: event.tool_id,
        content: event.output,
        isError: event.status === 'error',
      });
    });

    this.client.on('error_event', (event: any) => {
      this.emitError(new Error(event.message));
    });

    this.client.on('error', (error: Error) => {
      this.emitError(error);
    });
  }

  protected async doSendMessage(message: SDKMessage): Promise<void> {
    if (!this.client) {
      await this.start();
    }

    if (!this.client) {
      throw new Error('Gemini client not initialized');
    }

    this.setStatus('working');

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const runOptions: Record<string, unknown> = {
          outputFormat: this.outputFormat,
        };
        if (this.allowedMcpServerNames.length > 0) {
          runOptions.allowedMcpServerNames = this.allowedMcpServerNames;
        }

        const result = this.supportsResume
          ? await this.client.sendMessage(message.content, runOptions)
          : await this.client.startSession(message.content, runOptions);

        if (result.status === 'error') {
          const rawError = this.extractCliErrorText(result);

          if (this.supportsResume && this.isResumeUnsupportedError(rawError)) {
            this.supportsResume = false;
            if (typeof this.client.setSessionId === 'function') {
              this.client.setSessionId(null);
            }
            this.config.resumeSessionId = undefined;
            continue;
          }

          if (
            this.outputFormat === 'stream-json' &&
            this.isStreamJsonUnsupportedError(rawError)
          ) {
            this.outputFormat = 'json';
            continue;
          }

          throw new Error(rawError || 'Gemini CLI failed without an explicit error message.');
        }

        if (result.sessionId && result.sessionId !== this.config.resumeSessionId) {
          this.config.resumeSessionId = result.sessionId;
          this.emit('metadata', { sessionId: result.sessionId, model: this.config.model });
        }

        // In JSON mode we don't receive message_delta events, so emit final text directly.
        if (this.outputFormat === 'json') {
          const responseText = this.extractResponseText(result);
          if (responseText) {
            this.emitOutput(responseText, true, 'stdout');
          }
        } else {
          this.outputThrottler.flush(true);
        }

        // Ensure we clean up state whenever the process finishes
        this.setStatus('idle');
        this.emit('complete');
        return;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        if (this.supportsResume && this.isResumeUnsupportedError(err.message)) {
          this.supportsResume = false;
          if (typeof this.client.setSessionId === 'function') {
            this.client.setSessionId(null);
          }
          this.config.resumeSessionId = undefined;
          lastError = err;
          continue;
        }

        if (
          this.outputFormat === 'stream-json' &&
          this.isStreamJsonUnsupportedError(err.message)
        ) {
          this.outputFormat = 'json';
          lastError = err;
          continue;
        }

        this.emitError(err);
        throw err;
      }
    }

    const finalError = lastError || new Error('Gemini sendMessage failed after retries.');
    this.emitError(finalError);
    throw finalError;
  }

  private extractCliErrorText(result: any): string {
    return String(result?.error?.message || result?.stderr || '').trim();
  }

  private isResumeUnsupportedError(message: string): boolean {
    return /unknown argument:\s*resume/i.test(message);
  }

  private isStreamJsonUnsupportedError(message: string): boolean {
    return /output-format/i.test(message) && /stream-json/i.test(message);
  }

  private extractResponseText(result: any): string {
    if (typeof result?.assistantResponse === 'string' && result.assistantResponse.trim()) {
      return result.assistantResponse.trim();
    }

    const stdout = Array.isArray(result?.stdout) ? result.stdout : [];
    if (stdout.length === 0) {
      return '';
    }

    const joined = stdout.join('\n').trim();
    if (!joined) {
      return '';
    }

    // Newer Gemini CLI outputs JSON in non-stream mode.
    try {
      const parsed = JSON.parse(joined);
      const direct = parsed?.response || parsed?.text || parsed?.output || parsed?.content;
      if (typeof direct === 'string' && direct.trim()) {
        return direct.trim();
      }
    } catch {
      // Fall back to raw text below.
    }

    return joined;
  }

  async sendToolResult(result: SDKToolResult): Promise<void> {
    if (!this.client) return;

    if (typeof this.client.sendToolResult !== 'function') {
      if (this.config.debug) {
        console.warn('[GeminiSDK] sendToolResult not supported by @raylin01/gemini-client, ignoring.');
      }
      return;
    }

    try {
      await this.client.sendToolResult({
        toolUseId: result.toolUseId,
        content: result.content,
        isError: result.isError,
      });
    } catch (error) {
      console.warn('[GeminiSDK] Error sending tool result:', error);
    }
  }

  async sendApproval(
    requestId: string,
    decision: 'allow' | 'deny',
    _updatedInput?: Record<string, unknown>
  ): Promise<void> {
    if (!this.client) return;

    if (
      typeof this.client.approve !== 'function' ||
      typeof this.client.deny !== 'function'
    ) {
      if (this.config.debug) {
        console.warn('[GeminiSDK] Approval API not supported by @raylin01/gemini-client, ignoring.');
      }
      return;
    }

    try {
      if (decision === 'allow') {
        await this.client.approve(requestId);
      } else {
        await this.client.deny(requestId);
      }

      this.approvalTracker.delete(requestId);

      if (!this.hasPendingApprovals()) {
        this.setStatus('working');
      }
    } catch (error) {
      console.warn('[GeminiSDK] Error sending approval:', error);
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.shutdown();
      } catch (error) {
        console.warn('[GeminiSDK] Error during shutdown:', error);
      }
    }
    this.setStatus('idle');
  }
}
