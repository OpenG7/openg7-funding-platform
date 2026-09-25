import type { Server } from 'node:net';

export function createSmtpGate(options?: { host?: string; port?: number }): {
  server: Server;
  snapshot(): {
    mode: string;
    held: number;
    connections: number;
    rejected: number;
    forwarded: number;
  };
  setMode(value: 'allow' | 'hold' | 'reject'): void;
  close(): Promise<void>;
};
