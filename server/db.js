import 'dotenv/config';
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({
  path: [
    path.resolve(process.cwd(), 'server/.env'),
    path.resolve(process.cwd(), 'server/.env.local'),
    path.resolve(process.cwd(), '.env.local'),
  ],
  override: true,
});

import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
const sslConfig = connectionString ? { rejectUnauthorized: false } : false;

export const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: sslConfig,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    })
  : null;

if (pool) {
  pool.on('error', (error) => {
    console.error('[DB] Pool error:', error && error.code ? error.code : 'UNKNOWN_ERROR');
  });
}

export function getDatabaseStatus() {
  return {
    configured: Boolean(connectionString),
    host: connectionString ? (() => {
      try {
        const masked = connectionString.replace(/:[^:@/]+@/g, ':***@');
        return new URL(masked).hostname;
      } catch {
        return 'unknown';
      }
    })() : null,
    dbName: connectionString ? (() => {
      try {
        const masked = connectionString.replace(/:[^:@/]+@/g, ':***@');
        const url = new URL(masked);
        return (url.pathname || '/').replace(/^\//, '') || 'unknown';
      } catch {
        return 'unknown';
      }
    })() : null,
  };
}
