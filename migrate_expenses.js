import pg from 'pg';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: [
    path.resolve(__dirname, '.env'),
    path.resolve(__dirname, '.env.local'),
    path.resolve(__dirname, '..', '.env.local'),
  ],
  override: true,
});

const { Pool } = pg;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false }) : null;

async function migrate() {
  if (!pool) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  try {
    console.log('Reading schema.sql...');
    const schemaSql = fs.readFileSync(path.resolve(__dirname, 'server', 'schema.sql'), 'utf8');
    
    // Extract the expenses table creation part
    // We'll just run the whole schema.sql but it might fail if tables already exist.
    // A better way is to extract only the expenses part.
    
    const expensesTableMatch = schemaSql.match(/CREATE TABLE expenses \([\s\S]*?\);/);
    if (!expensesTableMatch) {
      throw new Error('Could not find CREATE TABLE expenses in schema.sql');
    }
    
    const sql = expensesTableMatch[0];
    console.log('Executing migration:\n', sql);
    
    await pool.query(sql);
    console.log('Migration successful: "expenses" table created.');

    // Verify
    const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'expenses'
    `);
    
    if (res.rows.length > 0) {
      console.log('Verification successful: Table "expenses" now exists.');
    } else {
      console.error('Verification failed: Table "expenses" still does not exist.');
    }

  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await pool.end();
  }
}

migrate();
