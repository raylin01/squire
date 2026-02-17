/**
 * SquireBot WebSocket Server
 *
 * Accepts connections from runner-agent and handles channel operations.
 */

import { WebSocketServer, WebSocket, RawData } from 'ws';
import type { Server as HttpServer } from 'http';
import type { SquireBotConfig } from './config.js';
import type { Client } from 'discord.js';

export interface WebSocketMessage {
  type: string;
  requestId?: string;
  data?: unknown;
}

export interface WebSocketResponse {
  type: 'response' | 'error' | 'event';
  requestId?: string;
  success?: boolean;
  data?: unknown;
  error?: string;
}

type MessageHandler = (message: WebSocketMessage, ws: AuthenticatedWebSocket) => Promise<WebSocketResponse | void>;

interface AuthenticatedWebSocket extends WebSocket {
  isAuthenticated: boolean;
  runnerId?: string;
}

export class SquireBotWebSocketServer {
  private wss: WebSocketServer | null = null;
  private config: SquireBotConfig;
  private discordClient: Client;
  private clients: Set<AuthenticatedWebSocket> = new Set();
  private handlers: Map<string, MessageHandler> = new Map();

  constructor(config: SquireBotConfig, discordClient: Client) {
    this.config = config;
    this.discordClient = discordClient;
  }

  /**
   * Start the WebSocket server
   */
  start(server?: HttpServer): void {
    if (server) {
      this.wss = new WebSocketServer({ server });
    } else {
      this.wss = new WebSocketServer({
        port: this.config.wsPort,
        host: this.config.wsHost,
      });
    }

    this.wss.on('connection', (ws: AuthenticatedWebSocket) => {
      ws.isAuthenticated = false;
      this.clients.add(ws);

      console.log('[WS] Client connected');

      ws.on('message', (data: RawData) => {
        this.handleMessage(data, ws).catch(error => {
          console.error('[WS] Error handling message:', error);
          this.sendError(ws, 'internal_error', error.message);
        });
      });

      ws.on('close', () => {
        console.log('[WS] Client disconnected');
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('[WS] WebSocket error:', error);
        this.clients.delete(ws);
      });
    });

    console.log(`[WS] Server listening on ${this.config.wsHost}:${this.config.wsPort}`);
  }

  /**
   * Stop the WebSocket server
   */
  stop(): void {
    if (this.wss) {
      // Close all clients
      for (const client of this.clients) {
        client.close();
      }
      this.clients.clear();

      this.wss.close();
      this.wss = null;
      console.log('[WS] Server stopped');
    }
  }

  /**
   * Register a message handler
   */
  on(type: string, handler: MessageHandler): void {
    this.handlers.set(type, handler);
  }

  /**
   * Broadcast an event to all authenticated clients
   */
  broadcast(type: string, data: unknown): void {
    const message: WebSocketResponse = {
      type: 'event',
      data: { type, ...data as object },
    };

    const payload = JSON.stringify(message);

    for (const client of this.clients) {
      if (client.isAuthenticated && client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  /**
   * Handle incoming message
   */
  private async handleMessage(data: RawData, ws: AuthenticatedWebSocket): Promise<void> {
    const raw = data.toString();
    let message: WebSocketMessage;

    try {
      message = JSON.parse(raw);
    } catch {
      this.sendError(ws, 'parse_error', 'Invalid JSON');
      return;
    }

    // Handle authentication
    if (message.type === 'auth') {
      const response = await this.handleAuth(message, ws);
      this.sendResponse(ws, message.requestId, response);
      return;
    }

    // Require authentication for all other messages
    if (!ws.isAuthenticated) {
      this.sendError(ws, message.requestId, 'Not authenticated');
      return;
    }

    // Find handler
    const handler = this.handlers.get(message.type);
    if (!handler) {
      this.sendError(ws, message.requestId, `Unknown message type: ${message.type}`);
      return;
    }

    try {
      const response = await handler(message, ws);
      if (response) {
        this.sendResponse(ws, message.requestId, response);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.sendError(ws, message.requestId, errorMessage);
    }
  }

  /**
   * Handle authentication
   */
  private async handleAuth(
    message: WebSocketMessage,
    ws: AuthenticatedWebSocket
  ): Promise<WebSocketResponse> {
    const token = (message.data as { token?: string })?.token;

    if (!token || token !== this.config.runnerToken) {
      return { type: 'error', success: false, error: 'Invalid token' };
    }

    ws.isAuthenticated = true;
    ws.runnerId = (message.data as { runnerId?: string })?.runnerId || 'unknown';

    console.log(`[WS] Runner authenticated: ${ws.runnerId}`);

    return {
      type: 'response',
      success: true,
      data: { message: 'Authenticated' },
    };
  }

  /**
   * Send response to client
   */
  private sendResponse(ws: WebSocket, requestId: string | undefined, response: WebSocketResponse): void {
    if (ws.readyState !== WebSocket.OPEN) return;

    const payload = JSON.stringify({
      ...response,
      requestId,
    });

    ws.send(payload);
  }

  /**
   * Send error to client
   */
  private sendError(ws: WebSocket, requestId: string | undefined, error: string): void {
    this.sendResponse(ws, requestId, {
      type: 'error',
      success: false,
      error,
    });
  }

  /**
   * Get connected clients count
   */
  getConnectedCount(): number {
    return this.clients.size;
  }
}
