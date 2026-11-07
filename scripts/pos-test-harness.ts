import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
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
  '@/lib/recovery-anchor': typeof import('../lib/recovery-anchor');
  '@/lib/recovery-journal': typeof import('../lib/recovery-journal');
  '@/lib/recovery-selector': typeof import('../lib/recovery-selector');
  '@/lib/recovery-reconciliation': typeof import('../lib/recovery-reconciliation');
  '@/lib/database-maintenance': typeof import('../lib/database-maintenance');
  '@/lib/database': typeof import('../lib/database');
  '@/lib/business': typeof import('../lib/business');
  '@/lib/password': typeof import('../lib/password');
  '@/lib/network/qr': typeof import('../lib/network/qr');
  '@/lib/network/operations': typeof import('../lib/network/operations');
  '@/lib/permissions': typeof import('../lib/permissions');
  '@/lib/network/pending-withdrawal': typeof import('../lib/network/pending-withdrawal');
  '@/lib/network/pending-operation': typeof import('../lib/network/pending-operation');
  '@/lib/network/client': typeof import('../lib/network/client');
  '@/lib/network/config': typeof import('../lib/network/config');
  '@/lib/use-pos-repository': typeof import('../lib/use-pos-repository');
  '@/lib/csv': typeof import('../lib/csv');
  '@/lib/network/host': typeof import('../lib/network/host');
  '@/lib/network/validation': typeof import('../lib/network/validation');
  '@/lib/network/tls': typeof import('../lib/network/tls');
  '@/lib/network/discovery': typeof import('../lib/network/discovery');
  '@/lib/network/pending-store': typeof import('../lib/network/pending-store');
  '@/lib/network/snapshot': typeof import('../lib/network/snapshot');
  '@/lib/network/pending-sale': typeof import('../lib/network/pending-sale');
  '@/lib/onat-report': typeof import('../lib/onat-report');
  '@/lib/onat-notifications': typeof import('../lib/onat-notifications');
  '@/lib/use-finance-command': typeof import('../lib/use-finance-command');
  '@/lib/use-onat': typeof import('../lib/use-onat');
};

export function createHarness(overrides: Record<string, unknown> = {}) {
  const database: Database = new sql.Database();
  const storage = new Map<string, string>();
  let primaryDatabaseExists = true;
  const openedDatabaseNames: string[] = [];
  let failSql = '';
  let recoveryFault:
    | 'close-active'
    | 'candidate-reopen'
    | 'candidate-copy'
    | 'selector-prepared'
    | 'selector-committed'
    | 'selector-committed-readback'
    | null = null;
  function injectRecoveryFault(stage: typeof recoveryFault) {
    if (stage !== null && recoveryFault === stage) {
      recoveryFault = null;
      throw new Error(`Injected recovery failure: ${stage}`);
    }
  }
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
    fixtureDatabase: database,
    closeAsync: async () => {
      injectRecoveryFault('close-active');
    },
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
  class TestAesKey {
    constructor(readonly raw: Buffer) {}
    static async generate() {
      return new TestAesKey(randomBytes(32));
    }
    static async import(value: string, encoding: 'base64' | 'hex') {
      return new TestAesKey(Buffer.from(value, encoding));
    }
    async encoded(encoding: 'base64' | 'hex') {
      return this.raw.toString(encoding);
    }
  }
  class TestSealedData {
    constructor(readonly raw: Buffer) {}
    static fromCombined(value: string) {
      return new TestSealedData(Buffer.from(value, 'base64'));
    }
    async combined() {
      return this.raw.toString('base64');
    }
  }
  const mocks: Record<string, unknown> = {
    'expo-sqlite': {
      defaultDatabaseDirectory: 'file:///private/SQLite',
      openDatabaseAsync: async (name: string) => {
        openedDatabaseNames.push(name);
        if (name === 'mipypos.db') {
          primaryDatabaseExists = true;
          return adapter;
        }
        if (name.startsWith('mipypos.restored.') && backups.has(name))
          injectRecoveryFault('candidate-reopen');
        let queryOnly = false;
        const queryRows = (query: string, args: unknown[] = []) => {
          const copy = backups.get(name);
          if (!copy) return [];
          const statement = copy.prepare(query);
          try {
            statement.bind(values(args));
            const rows: Record<string, SqlValue>[] = [];
            while (statement.step()) rows.push(statement.getAsObject());
            return rows;
          } finally {
            statement.free();
          }
        };
        const write = (query: string, args: unknown[] = []) => {
          if (queryOnly) throw new Error('Read-only fixture connection');
          if (failSql && query.includes(failSql)) throw new Error('Injected write failure');
          const copy = backups.get(name);
          if (!copy) throw new Error('Missing fixture database');
          // sql.js with an empty bind array executes only the first statement.
          // Expo execAsync executes the whole batch, including migration DDL.
          copy.run(query, args.length ? values(args) : undefined);
          return {
            changes: copy.getRowsModified(),
            lastInsertRowId: Number(queryRows('SELECT last_insert_rowid() AS id')[0]?.id ?? 0),
          };
        };
        return {
          name,
          get fixtureDatabase() {
            return backups.get(name);
          },
          execAsync: async (query: string) => {
            if (query === 'PRAGMA query_only=ON') {
              queryOnly = true;
              return;
            }
            if (backups.has(name)) write(query);
          },
          runAsync: async (query: string, ...args: unknown[]) => write(query, args),
          getFirstAsync: async (query: string, ...args: unknown[]) =>
            queryRows(query, args)[0] ?? null,
          getAllAsync: async (query: string, ...args: unknown[]) => queryRows(query, args),
          withTransactionAsync: async (action: () => Promise<void>) => {
            write('BEGIN IMMEDIATE');
            try {
              await action();
              write('COMMIT');
            } catch (error) {
              write('ROLLBACK');
              throw error;
            }
          },
          closeAsync: async () => undefined,
        };
      },
      backupDatabaseAsync: async ({
        sourceDatabase,
        destDatabase,
      }: {
        sourceDatabase: { fixtureDatabase: Database };
        destDatabase: { name: string };
      }) => {
        if (failSql === 'BACKUP') throw new Error('Injected backup failure');
        if (destDatabase.name.startsWith('mipypos.restored.'))
          injectRecoveryFault('candidate-copy');
        backups.set(destDatabase.name, new sql.Database(sourceDatabase.fixtureDatabase.export()));
      },
    },
    'expo-file-system': {
      Directory: class {
        readonly exists = true;
        list() {
          return Array.from(backups.keys(), (name) => ({ name }));
        }
      },
      File: class {
        readonly name: string;
        constructor(_directory: string, name: string) {
          this.name = name;
        }
        get exists() {
          return (this.name === 'mipypos.db' && primaryDatabaseExists) || backups.has(this.name);
        }
      },
    },
    'expo-crypto': {
      CryptoDigestAlgorithm: { SHA256: 'SHA256' },
      digestStringAsync: async (_algorithm: string, input: string) =>
        createHash('sha256').update(input).digest('hex'),
      randomUUID,
      getRandomBytes: (length: number) => new Uint8Array(randomBytes(length)),
      AESEncryptionKey: TestAesKey,
      AESSealedData: TestSealedData,
      aesEncryptAsync: async (
        bytes: Uint8Array,
        key: TestAesKey,
        options: { additionalData: Uint8Array },
      ) => {
        const nonce = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', key.raw, nonce);
        cipher.setAAD(options.additionalData);
        const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
        return new TestSealedData(Buffer.concat([nonce, encrypted, cipher.getAuthTag()]));
      },
      aesDecryptAsync: async (
        sealed: TestSealedData,
        key: TestAesKey,
        options: { additionalData: Uint8Array },
      ) => {
        const decipher = createDecipheriv('aes-256-gcm', key.raw, sealed.raw.subarray(0, 12));
        decipher.setAAD(options.additionalData);
        decipher.setAuthTag(sealed.raw.subarray(-16));
        return Buffer.concat([decipher.update(sealed.raw.subarray(12, -16)), decipher.final()]);
      },
    },
    '@react-native-async-storage/async-storage': {
      __esModule: true,
      default: {
        getItem: async (key: string) => {
          const value = storage.get(key) ?? null;
          if (key === 'mipypos.recovery.selector.v1' && value?.includes('"phase":"committed"'))
            injectRecoveryFault('selector-committed-readback');
          return value;
        },
        setItem: async (key: string, value: string) => {
          if (key === 'mipypos.recovery.selector.v1') {
            if (value.includes('"phase":"prepared"')) injectRecoveryFault('selector-prepared');
            if (value.includes('"phase":"committed"')) injectRecoveryFault('selector-committed');
          }
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
    openedDatabaseNames,
    setPrimaryDatabaseExists: (exists: boolean) => {
      primaryDatabaseExists = exists;
    },
    reloadModules: () => cache.clear(),
    failWritesContaining: (query: string) => {
      failSql = query;
    },
    failRecoveryStageOnce: (stage: NonNullable<typeof recoveryFault>) => {
      recoveryFault = stage;
    },
  };
}
