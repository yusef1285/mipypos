import type { SQLiteDatabase } from 'expo-sqlite';

// v10 enterprise modules. Only CREATE ... IF NOT EXISTS: existing tables are not
// altered (their recovery triggers capture exact column images) and no rows are
// seeded, so a migrated recovery candidate keeps an identical journal prefix.
export const BUSINESS_V10_TABLES = [
  'branches',
  'area_branches',
  'sale_tickets',
  'stock_transfers',
  'stock_transfer_lines',
  'parties',
  'party_ledger',
  'currencies',
  'exchange_rates',
  'employees',
  'payroll_runs',
  'payroll_lines',
  'partners',
  'partner_movements',
  'cash_entries',
] as const;

const APPEND_ONLY = [
  'party_ledger',
  'exchange_rates',
  'payroll_lines',
  'partner_movements',
  'cash_entries',
] as const;

export async function migrateBusiness(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(trim(name)) BETWEEN 1 AND 120),
      code TEXT NOT NULL UNIQUE CHECK(code GLOB '[A-Z0-9-]*' AND length(code) BETWEEN 1 AND 12),
      address TEXT NOT NULL DEFAULT '',
      ticket_prefix TEXT NOT NULL DEFAULT '' CHECK(length(ticket_prefix)<=8),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS area_branches (
      area_id INTEGER PRIMARY KEY REFERENCES areas(id) ON DELETE CASCADE,
      branch_id INTEGER NOT NULL REFERENCES branches(id)
    );
    CREATE TABLE IF NOT EXISTS sale_tickets (
      sale_id INTEGER PRIMARY KEY REFERENCES sales(id),
      branch_key INTEGER NOT NULL DEFAULT 0 CHECK(branch_key>=0),
      ticket_number INTEGER NOT NULL CHECK(ticket_number>0),
      UNIQUE(branch_key,ticket_number)
    );
    CREATE TABLE IF NOT EXISTS stock_transfers (
      id TEXT PRIMARY KEY,
      from_area_id INTEGER NOT NULL REFERENCES areas(id),
      to_area_id INTEGER NOT NULL REFERENCES areas(id),
      from_area TEXT NOT NULL,
      to_area TEXT NOT NULL,
      from_branch_id INTEGER REFERENCES branches(id),
      to_branch_id INTEGER REFERENCES branches(id),
      status TEXT NOT NULL CHECK(status IN ('sent','partial','received','cancelled')),
      note TEXT NOT NULL DEFAULT '',
      sent_by TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      received_by TEXT,
      received_at TEXT,
      cancel_reason TEXT,
      CHECK(from_area_id<>to_area_id)
    );
    CREATE TABLE IF NOT EXISTS stock_transfer_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transfer_id TEXT NOT NULL REFERENCES stock_transfers(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      unit TEXT NOT NULL,
      quantity_sent REAL NOT NULL CHECK(quantity_sent>0),
      quantity_received REAL NOT NULL DEFAULT 0 CHECK(quantity_received>=0),
      quantity_returned REAL NOT NULL DEFAULT 0 CHECK(quantity_returned>=0),
      quantity_lost REAL NOT NULL DEFAULT 0 CHECK(quantity_lost>=0),
      unit_cost REAL CHECK(unit_cost IS NULL OR unit_cost>=0),
      UNIQUE(transfer_id,product_id),
      CHECK(quantity_received+quantity_returned+quantity_lost<=quantity_sent+0.0005)
    );
    CREATE TABLE IF NOT EXISTS parties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK(kind IN ('client','supplier','both')),
      name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
      document TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      credit_limit REAL NOT NULL DEFAULT 0 CHECK(credit_limit>=0),
      notes TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS currencies (
      code TEXT PRIMARY KEY CHECK(code GLOB '[A-Z][A-Z][A-Z]' AND length(code)=3),
      name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      decimals INTEGER NOT NULL DEFAULT 2 CHECK(decimals BETWEEN 0 AND 4),
      is_base INTEGER NOT NULL DEFAULT 0 CHECK(is_base IN (0,1))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS currencies_single_base ON currencies(is_base) WHERE is_base=1;
    CREATE TABLE IF NOT EXISTS exchange_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL REFERENCES currencies(code),
      rate REAL NOT NULL CHECK(rate>0),
      effective_date TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT '',
      username TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS exchange_rates_lookup ON exchange_rates(code,effective_date,id);
    CREATE TABLE IF NOT EXISTS cash_entries (
      id TEXT PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
      direction TEXT NOT NULL CHECK(direction IN ('in','out')),
      amount REAL NOT NULL CHECK(amount>0),
      currency TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('ledger','payroll','partner')),
      source_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      username TEXT NOT NULL,
      date TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cash_entries_session ON cash_entries(session_id);
    CREATE TABLE IF NOT EXISTS party_ledger (
      id TEXT PRIMARY KEY,
      party_id INTEGER NOT NULL REFERENCES parties(id),
      side TEXT NOT NULL CHECK(side IN ('receivable','payable')),
      kind TEXT NOT NULL CHECK(kind IN ('charge','payment','reversal')),
      amount REAL NOT NULL CHECK(amount>0),
      currency TEXT NOT NULL,
      rate REAL NOT NULL CHECK(rate>0),
      base_amount REAL NOT NULL CHECK(base_amount>0),
      method TEXT CHECK(method IS NULL OR method IN ('cash','transfer','other')),
      reference TEXT NOT NULL DEFAULT '',
      due_date TEXT,
      note TEXT NOT NULL DEFAULT '',
      reverses_id TEXT UNIQUE REFERENCES party_ledger(id),
      cash_entry_id TEXT REFERENCES cash_entries(id),
      username TEXT NOT NULL,
      date TEXT NOT NULL,
      CHECK((kind='reversal')=(reverses_id IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS party_ledger_party ON party_ledger(party_id,side);
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
      document TEXT NOT NULL DEFAULT '',
      position TEXT NOT NULL DEFAULT '',
      branch_id INTEGER REFERENCES branches(id),
      base_salary REAL NOT NULL CHECK(base_salary>=0),
      pay_period TEXT NOT NULL CHECK(pay_period IN ('monthly','biweekly','weekly')),
      start_date TEXT NOT NULL,
      end_date TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      CHECK(end_date IS NULL OR end_date>=start_date)
    );
    CREATE TABLE IF NOT EXISTS payroll_runs (
      id TEXT PRIMARY KEY,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft','approved','paid','void')),
      contribution_rate REAL NOT NULL CHECK(contribution_rate BETWEEN 0 AND 100),
      gross_total REAL NOT NULL CHECK(gross_total>=0),
      deductions_total REAL NOT NULL CHECK(deductions_total>=0),
      net_total REAL NOT NULL CHECK(net_total>=0),
      contribution_total REAL NOT NULL CHECK(contribution_total>=0),
      note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      approved_by TEXT,
      approved_at TEXT,
      paid_by TEXT,
      paid_at TEXT,
      method TEXT CHECK(method IS NULL OR method IN ('cash','transfer','other')),
      cash_entry_id TEXT REFERENCES cash_entries(id),
      void_reason TEXT,
      CHECK(period_end>=period_start)
    );
    CREATE TABLE IF NOT EXISTS payroll_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES payroll_runs(id),
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      employee_name TEXT NOT NULL,
      base REAL NOT NULL CHECK(base>=0),
      bonuses REAL NOT NULL CHECK(bonuses>=0),
      deductions REAL NOT NULL CHECK(deductions>=0),
      gross REAL NOT NULL CHECK(gross>=0),
      net REAL NOT NULL CHECK(net>=0),
      contribution REAL NOT NULL CHECK(contribution>=0),
      UNIQUE(run_id,employee_id)
    );
    CREATE TABLE IF NOT EXISTS partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
      document TEXT NOT NULL DEFAULT '',
      share_percent REAL NOT NULL CHECK(share_percent BETWEEN 0 AND 100),
      joined_at TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
    );
    CREATE TABLE IF NOT EXISTS partner_movements (
      id TEXT PRIMARY KEY,
      partner_id INTEGER NOT NULL REFERENCES partners(id),
      kind TEXT NOT NULL CHECK(kind IN ('contribution','withdrawal','dividend','reversal')),
      amount REAL NOT NULL CHECK(amount>0),
      currency TEXT NOT NULL,
      rate REAL NOT NULL CHECK(rate>0),
      base_amount REAL NOT NULL CHECK(base_amount>0),
      method TEXT NOT NULL CHECK(method IN ('cash','transfer','other')),
      note TEXT NOT NULL DEFAULT '',
      reverses_id TEXT UNIQUE REFERENCES partner_movements(id),
      cash_entry_id TEXT REFERENCES cash_entries(id),
      username TEXT NOT NULL,
      date TEXT NOT NULL,
      CHECK((kind='reversal')=(reverses_id IS NOT NULL))
    );
    CREATE TRIGGER IF NOT EXISTS sale_tickets_no_update BEFORE UPDATE ON sale_tickets
      BEGIN SELECT RAISE(ABORT,'La numeración de tickets no se modifica.'); END;
    CREATE TRIGGER IF NOT EXISTS payroll_runs_frozen_amounts BEFORE UPDATE OF
      period_start,period_end,contribution_rate,gross_total,deductions_total,net_total,contribution_total,created_by,created_at
      ON payroll_runs
      BEGIN SELECT RAISE(ABORT,'Los importes de una nómina no se modifican. Anúlala y crea otra.'); END;
    CREATE TRIGGER IF NOT EXISTS payroll_runs_status_flow BEFORE UPDATE OF status ON payroll_runs
      WHEN NOT ((OLD.status='draft' AND NEW.status IN ('approved','void'))
        OR (OLD.status='approved' AND NEW.status IN ('paid','void'))
        OR (OLD.status='paid' AND NEW.status='void'))
      BEGIN SELECT RAISE(ABORT,'Cambio de estado de nómina no permitido.'); END;
    CREATE TRIGGER IF NOT EXISTS stock_transfer_lines_frozen BEFORE UPDATE OF
      transfer_id,product_id,product_name,unit,quantity_sent,unit_cost ON stock_transfer_lines
      BEGIN SELECT RAISE(ABORT,'Las líneas enviadas de un traslado no se modifican.'); END;
  `);
  for (const table of APPEND_ONLY)
    await db.execAsync(`
      CREATE TRIGGER IF NOT EXISTS ${table}_no_update BEFORE UPDATE ON ${table}
        BEGIN SELECT RAISE(ABORT,'Este registro es inalterable. Registra una reversión.'); END;
      CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table}
        BEGIN SELECT RAISE(ABORT,'Este registro es inalterable. Registra una reversión.'); END;`);
  // Shared rows invalidate LAN catalog caches exactly like the v9 tables.
  for (const table of BUSINESS_V10_TABLES) {
    const fields = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
    const changed = fields.map((f) => `OLD."${f.name}" IS NOT NEW."${f.name}"`).join(' OR ');
    for (const event of ['INSERT', 'DELETE', 'UPDATE'] as const)
      await db.execAsync(`CREATE TRIGGER IF NOT EXISTS sync_${table}_${event.toLowerCase()}
        AFTER ${event} ON ${table} ${event === 'UPDATE' ? `WHEN ${changed}` : ''}
        BEGIN UPDATE sync_state SET revision=revision+1 WHERE id=1; END;`);
  }
}
