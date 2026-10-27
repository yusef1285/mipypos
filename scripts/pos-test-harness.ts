import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { compileFunction } from 'node:vm';
import initSqlJs, { type Database, type SqlValue, type SqlJsStatic } from 'sql.js';
import ts from 'typescript';

const nodeRequire = createRequire(import.meta.url);
const sqlPromise = initSqlJs();
let sql: SqlJsStatic;
export async function prepareHarness() {
  sql = await sqlPromise;
}
function values(args: unknown[]): SqlValue[] {
  const parameters: unknown[] = Array.isArray(args[0]) ? args[0] : args;
  return parameters.map((value) => {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      value instanceof Uint8Array
    )
      return value;
    throw new TypeError('Unsupported SQLite parameter');
  });
}

type HarnessModules = {
  '@/lib/database': typeof import('../lib/database');
  '@/lib/network/qr': typeof import('../lib/network/qr');
  '@/lib/network/operations': typeof import('../lib/network/operations');
  '@/lib/permissions': typeof import('../lib/permissions');
  '@/lib/network/pending-withdrawal': typeof import('../lib/network/pending-withdrawal');
  '@/lib/network/pending-operation': typeof import('../lib/network/pending-operation');
  '@/lib/network/client': typeof import('../lib/network/client');
  '@/lib/network/config': typeof import('../lib/network/config');
  '@/lib/csv': typeof import('../lib/csv');
  '@/lib/network/host': typeof import('../lib/network/host');
  '@/lib/network/validation': typeof import('../lib/network/validation');
  '@/lib/network/tls': typeof import('../lib/network/tls');
  '@/lib/network/pending-sale': typeof import('../lib/network/pending-sale');
};

export function createHarness(overrides: Record<string, unknown> = {}) {
  const database: Database = new sql.Database();
  const storage = new Map<string, string>();
  let failSql = '';
  const all = (query: string, args: unknown[] = []) => {
    const statement = database.prepare(query);
    try {
      statement.bind(values(args));
      const rows: Record<string, SqlValue>[] = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally {
      statement.free();
    }
  };
  const adapter = {
    execAsync: async (query: string) => {
      database.run(query);
    },
    getAllAsync: async (query: string, ...args: unknown[]) => all(query, args),
    getFirstAsync: async (query: string, ...args: unknown[]) => all(query, args)[0] ?? null,
    runAsync: async (query: string, ...args: unknown[]) => {
      if (failSql && query.includes(failSql)) throw new Error('Injected write failure');
      database.run(query, values(args));
      const changes = database.getRowsModified();
      const id = all('SELECT last_insert_rowid() AS id')[0]?.id;
      return { changes, lastInsertRowId: Number(id) };
    },
    withTransactionAsync: async (action: () => Promise<void>) => {
      database.run('BEGIN IMMEDIATE');
      try {
        await action();
        database.run('COMMIT');
      } catch (error) {
        database.run('ROLLBACK');
        throw error;
      }
    },
  };
  const backups = new Map<string, Database>();
  const mocks: Record<string, unknown> = {
    'expo-sqlite': {
      openDatabaseAsync: async (name: string) =>
        name === 'mipypos.db'
          ? adapter
          : {
              name,
              getFirstAsync: async (query: string) => {
                const copy = backups.get(name);
                if (!copy) return null;
                const statement = copy.prepare(query);
                try {
                  return statement.step() ? statement.getAsObject() : null;
                } finally {
                  statement.free();
                }
              },
              closeAsync: async () => undefined,
            },
      backupDatabaseAsync: async ({ destDatabase }: { destDatabase: { name: string } }) => {
        if (failSql === 'BACKUP') throw new Error('Injected backup failure');
        backups.set(destDatabase.name, new sql.Database(database.export()));
      },
    },
    'expo-crypto': {
      CryptoDigestAlgorithm: { SHA256: 'SHA256' },
      digestStringAsync: async (_algorithm: string, input: string) =>
        createHash('sha256').update(input).digest('hex'),
      randomUUID,
    },
    '@react-native-async-storage/async-storage': {
      __esModule: true,
      default: {
        getItem: async (key: string) => storage.get(key) ?? null,
        setItem: async (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: async (key: string) => {
          storage.delete(key);
        },
      },
    },
    'react-native': { Platform: { OS: 'android' }, NativeModules: {} },
    'expo-secure-store': {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device',
      getItemAsync: async (key: string) => storage.get(`secure:${key}`) ?? null,
      setItemAsync: async (key: string, value: string) => {
        storage.set(`secure:${key}`, value);
      },
      deleteItemAsync: async (key: string) => {
        storage.delete(`secure:${key}`);
      },
    },
    ...overrides,
  };
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  function load<Id extends keyof HarnessModules>(id: Id): HarnessModules[Id];
  function load(id: string): unknown;
  function load(id: string): unknown {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (!id.startsWith('@/')) return nodeRequire(id) as unknown;
    const file = resolve(process.cwd(), `${id.slice(2)}.ts`);
    const cached = cache.get(file);
    if (cached) return cached.exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    compileFunction(code, ['require', 'module', 'exports'], { filename: file })(
      load,
      module,
      module.exports,
    );
    return module.exports;
  }
  return {
    database,
    backups,
    storage,
    load,
    failWritesContaining: (query: string) => {
      failSql = query;
    },
  };
}
