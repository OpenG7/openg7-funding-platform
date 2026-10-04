import { createHash } from 'node:crypto';

export const sqlLiteral = (value) => `'${value.replace(/'/g, "''")}'`;

export const sha256Hex = (value) =>
  createHash('sha256').update(value).digest('hex');
