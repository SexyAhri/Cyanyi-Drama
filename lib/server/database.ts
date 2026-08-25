import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import initSqlJs, { type Database } from "sql.js";

const DATABASE_DIR = path.join(process.cwd(), "data");
const DATABASE_FILE = path.join(DATABASE_DIR, "cyanyi.sqlite");

let databasePromise: Promise<Database> | null = null;
let writeQueue = Promise.resolve();

export async function getDatabase() {
  if (!databasePromise) {
    databasePromise = openDatabase();
  }
  return databasePromise;
}

export async function persistDatabase() {
  const database = await getDatabase();
  writeQueue = writeQueue.then(async () => {
    await mkdir(DATABASE_DIR, { recursive: true });
    await writeFile(DATABASE_FILE, Buffer.from(database.export()));
  });
  return writeQueue;
}

export function resetDatabaseForTests() {
  databasePromise = null;
  writeQueue = Promise.resolve();
}

async function openDatabase() {
  const SQL = await initSqlJs({
    locateFile: (file: string) =>
      path.join(process.cwd(), "node_modules", "sql.js", "dist", file),
  });
  let database: Database;
  try {
    database = new SQL.Database(await readFile(DATABASE_FILE));
  } catch {
    database = new SQL.Database();
  }
  initializeSchema(database);
  return database;
}

function initializeSchema(database: Database) {
  database.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      password_hash TEXT,
      display_name TEXT NOT NULL,
      anonymous INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL,
      base_url TEXT NOT NULL,
      encrypted_api_keys TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, id)
    );
    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      model_id TEXT NOT NULL,
      name TEXT NOT NULL,
      model_type TEXT NOT NULL,
      capabilities_json TEXT NOT NULL,
      selected INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(channel_id, model_id)
    );
    CREATE TABLE IF NOT EXISTS media_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      kind TEXT NOT NULL,
      provider TEXT NOT NULL,
      protocol TEXT NOT NULL,
      model TEXT NOT NULL,
      provider_task_id TEXT,
      payload_json TEXT NOT NULL,
      error_json TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 2,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS media_tasks_user_idx ON media_tasks(user_id, updated_at);
    CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES media_tasks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      url TEXT NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL
    );
  `);
  try {
    database.run("ALTER TABLE models ADD COLUMN selected INTEGER NOT NULL DEFAULT 1");
  } catch {
    // Existing databases already have the column.
  }
}

export function queryRows<T extends Record<string, unknown>>(
  database: Database,
  sql: string,
  params: unknown[] = [],
) {
  const statement = database.prepare(sql);
  statement.bind(params);
  const rows: T[] = [];
  while (statement.step()) {
    rows.push(statement.getAsObject() as T);
  }
  statement.free();
  return rows;
}

export function runSql(
  database: Database,
  sql: string,
  params: unknown[] = [],
) {
  database.run(sql, params);
}
