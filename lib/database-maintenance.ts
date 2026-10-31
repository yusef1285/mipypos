import type { SQLiteDatabase } from 'expo-sqlite';

const maintenanceMessage = 'La recuperación está en curso. Espera a que termine antes de operar.';
let maintenance = false;
export function assertDatabaseAvailable() {
  if (maintenance) throw new Error(maintenanceMessage);
}
export function beginDatabaseMaintenance() {
  assertDatabaseAvailable();
  maintenance = true;
}
export function endDatabaseMaintenance() {
  maintenance = false;
}

// Every async call on the shared handle is tracked, including reads outside the
// mutation queue. Sealing invalidates retained handles before SQLite is closed.
export class DatabaseConnectionGate {
  private sealed = false;
  private pending = new Set<Promise<unknown>>();
  readonly database: SQLiteDatabase;
  constructor(readonly raw: SQLiteDatabase) {
    this.database = new Proxy(raw, {
      get: (target, property) => {
        const value: unknown = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]): unknown => {
          if (this.sealed) throw new Error(maintenanceMessage);
          const result: unknown = Reflect.apply(value, target, args);
          if (!(result instanceof Promise)) return result;
          this.pending.add(result);
          void result.finally(() => this.pending.delete(result)).catch(() => undefined);
          return result;
        };
      },
    });
  }
  async sealAndDrain() {
    this.sealed = true;
    await Promise.allSettled(this.pending);
  }
  resume() {
    this.sealed = false;
  }
}
