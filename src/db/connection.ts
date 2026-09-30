import Database from 'better-sqlite3';

export function openDatabase(dbPath: string): Database.Database {
  return new Database(dbPath);
}
