import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, StatementSync } from 'node:sqlite';

import { MemoryStore } from '../types/index.js';

export class SqliteMemoryStore implements MemoryStore {
  private readonly database: DatabaseSync;
  private readonly insertAction: StatementSync;
  private readonly insertDeployment: StatementSync;
  private readonly insertIncident: StatementSync;
  private readonly insertReport: StatementSync;
  private readonly selectLastStable: StatementSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS deployments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        version TEXT NOT NULL,
        status TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        severity TEXT NOT NULL,
        summary TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        path TEXT NOT NULL,
        success INTEGER NOT NULL,
        summary TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        action TEXT NOT NULL,
        result TEXT NOT NULL,
        success INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        user TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL
      );
    `);

    this.insertAction = this.database.prepare(
      'INSERT INTO actions(action, result, success, duration_ms, user) VALUES (?, ?, ?, ?, ?)'
    );
    this.insertDeployment = this.database.prepare(
      'INSERT INTO deployments(version, status) VALUES (?, ?)'
    );
    this.insertIncident = this.database.prepare(
      'INSERT INTO incidents(severity, summary) VALUES (?, ?)'
    );
    this.insertReport = this.database.prepare(
      'INSERT INTO reports(path, success, summary) VALUES (?, ?, ?)'
    );
    this.selectLastStable = this.database.prepare(
      "SELECT version FROM deployments WHERE status = 'stable' ORDER BY created_at DESC, id DESC LIMIT 1"
    );
  }

  recordAction(input: {
    readonly action: string;
    readonly durationMs: number;
    readonly result: string;
    readonly success: boolean;
    readonly user: string;
  }): void {
    this.insertAction.run(
      input.action,
      input.result,
      input.success ? 1 : 0,
      Math.round(input.durationMs),
      input.user
    );
  }

  recordDeployment(input: {
    readonly status: string;
    readonly version: string;
  }): void {
    this.insertDeployment.run(input.version, input.status);
  }

  recordIncident(input: {
    readonly severity: string;
    readonly summary: string;
  }): void {
    this.insertIncident.run(input.severity, input.summary);
  }

  recordReport(input: {
    readonly path: string;
    readonly success: boolean;
    readonly summary: string;
  }): void {
    this.insertReport.run(input.path, input.success ? 1 : 0, input.summary);
  }

  lastStableDeployment(): string | null {
    const row = this.selectLastStable.get() as { version?: string } | undefined;
    return row?.version ?? null;
  }

  close(): void {
    this.database.close();
  }
}
