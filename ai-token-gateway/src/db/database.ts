// ============================================================
// Database Module: SQLite connection, initialization, and lifecycle
// ============================================================

import Database from 'better-sqlite3';
import { ALL_TABLE_STATEMENTS, CREATE_INDEXES } from './schema.js';

let db: Database.Database | null = null;

/**
 * 初始化 SQLite 数据库连接并创建所有表和索引。
 * 如果数据库已初始化，直接返回现有实例。
 */
export function initializeDatabase(dbPath: string): Database.Database {
  if (db) {
    return db;
  }

  db = new Database(dbPath);

  // 启用 WAL 模式提升并发读写性能
  db.pragma('journal_mode = WAL');
  // 启用外键约束
  db.pragma('foreign_keys = ON');

  // 在事务中创建所有表和索引
  const migrate = db.transaction(() => {
    for (const sql of ALL_TABLE_STATEMENTS) {
      db!.exec(sql);
    }
    for (const sql of CREATE_INDEXES) {
      db!.exec(sql);
    }
  });

  migrate();

  return db;
}

/**
 * 获取当前数据库实例。
 * 如果数据库未初始化，抛出错误。
 */
export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

/**
 * 关闭数据库连接并清理引用。
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
