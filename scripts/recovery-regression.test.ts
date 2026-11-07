import assert from 'node:assert/strict';
import { after, before as beforeAll, test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database } from 'sql.js';
import type { CartItem } from '../lib/models';
import { createHarness, prepareHarness } from './pos-test-harness';

beforeAll(prepareHarness);
let passed = 0;
const failures: { name: string; message: string }[] = [];
function check(name: string, action: () => Promise<void>) {
  void test(name, async () => {
    try {
      await action();
      passed += 1;
    } catch (error) {
      failures.push({
        name,
        message: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
      throw error;
    }
  });
}
after(() => {
  mkdirSync(join(process.cwd(), '.expo'), { recursive: true });
  writeFileSync(
    join(process.cwd(), '.expo/recovery-regression-results.json'),
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        tests: passed + failures.length,
        passed,
        failed: failures.length,
        failures,
      },
      null,
      2,
    ),
  );
});
function stripJournal(database: Database) {
  for (const [name] of database.exec(
    "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'recovery_%'",
  )[0]?.values ?? [])
    database.run(`DROP TRIGGER "${String(name).replaceAll('"', '""')}"`);
  database.run('DROP TABLE recovery_journal; DROP TABLE recovery_lineage; PRAGMA user_version=8');
}
function mutateWithoutCapture(database: Database, table: string, query: string) {
  const triggers =
    database.exec(
      `SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'recovery_capture_${table}_%'`,
    )[0]?.values ?? [];
  for (const [name] of triggers) database.run(`DROP TRIGGER "${String(name)}"`);
  database.run(query);
  for (const [, sql] of triggers) database.run(String(sql));
}
async function fixture() {
  const h = createHarness({ '@/lib/network/host': { stopLanHostAndDrain: async () => undefined } });
  const db = h.load('@/lib/database');
  await db.initializeDatabase();
  const id = await db.saveProduct(
    {
      name: 'Harina de trigo integral',
      category: 'Alimentos',
      subcategory: '',
      unit: 'kg',
      quantity_decimals: 3,
      stock: 20,
      price_cash: 100,
      price_transfer: 100,
      image_path: null,
    },
    'admin',
  );
  const product = await db.getProduct(id);
  assert.ok(product);
  const area = (await db.listAreas())[0];
  const session = await db.openCashSession(0, 'admin');
  const cart: CartItem[] = [{ product, price: 100, quantity: 1, areaId: area.id }];
  const copy = await db.createPrivateRecoveryBackup('admin', 'admin123');
  const restore = () => db.restorePrivateRecoveryBackup('admin', 'admin123', copy.id, true);
  const sale = (command = { commandId: 'recovery-confirmed-sale', clientId: 'terminal-1' }) =>
    db.registerSale(cart, 'cash', [{ type: 'cash', amount: 100 }], 'admin', command);
  return { ...h, db, copy, product, area, session, restore, sale, cart };
}

const IDENTITY_KEY = 'secure:mipypos.recovery.identity.v1';
const IDENTITY_WITNESS = 'mipypos.recovery.identity.witness.v1';

check(
  'instalación nueva reserva creación y confirma identidad sin modificar licencias',
  async () => {
    const h = createHarness();
    h.setPrimaryDatabaseExists(false);
    const db = h.load('@/lib/database');
    await db.initializeDatabase();
    const anchor = await h.load('@/lib/recovery-anchor').loadDatabaseAnchor();
    assert.equal(anchor?.phase, 'ready');
    assert.equal(h.storage.get(IDENTITY_WITNESS), 'present');
    assert.equal(await db.getSetting('license_mode'), 'demo');
    assert.equal((await db.listUsers()).length, 1);
  },
);
check(
  'interrupción antes de crear archivo no se confunde con una primera instalación',
  async () => {
    const h = createHarness();
    h.setPrimaryDatabaseExists(false);
    const selector = h.load('@/lib/recovery-selector');
    assert.equal((await selector.resolveDatabaseFile()).fileName, 'mipypos.db');
    assert.equal((await h.load('@/lib/recovery-anchor').loadDatabaseAnchor())?.phase, 'opening');
    h.reloadModules();
    await assert.rejects(
      h.load('@/lib/database').initializeDatabase(),
      /No se creará una base vacía/,
    );
    assert.equal(h.openedDatabaseNames.length, 0);
  },
);
check(
  'base principal perdida bloquea SQLite antes de abrir o generar datos iniciales',
  async () => {
    const f = await fixture();
    const opens = f.openedDatabaseNames.length;
    const users = f.database.exec('SELECT * FROM users');
    f.setPrimaryDatabaseExists(false);
    f.reloadModules();
    await assert.rejects(
      f.load('@/lib/database').initializeDatabase(),
      /No se creará una base vacía/,
    );
    assert.equal(f.openedDatabaseNames.length, opens);
    assert.deepEqual(f.database.exec('SELECT * FROM users'), users);
  },
);
check(
  'copia privada sin base original bloquea una instalación nueva incluso sin ancla',
  async () => {
    const f = await fixture();
    f.storage.delete(IDENTITY_KEY);
    f.storage.delete(IDENTITY_WITNESS);
    f.setPrimaryDatabaseExists(false);
    const opens = f.openedDatabaseNames.length;
    await assert.rejects(
      f.load('@/lib/recovery-selector').resolveDatabaseFile(),
      /No se creará una base vacía/,
    );
    assert.equal(f.openedDatabaseNames.length, opens);
    assert.ok(f.backups.has(f.copy.fileName));
  },
);
check(
  'archivo vacío que reemplaza una base instalada no regenera administrador ni licencia',
  async () => {
    const h = createHarness();
    const db = h.load('@/lib/database');
    await db.initializeDatabase();
    const tables = h.database.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )[0].values;
    h.database.run('PRAGMA foreign_keys=OFF');
    for (const [name] of tables) h.database.run(`DROP TABLE "${String(name)}"`);
    h.database.run('PRAGMA user_version=0');
    h.reloadModules();
    await assert.rejects(
      h.load('@/lib/database').initializeDatabase(),
      /identidad de recuperación/,
    );
    assert.equal(h.database.exec("SELECT name FROM sqlite_master WHERE name='users'").length, 0);
    assert.equal(h.database.exec('PRAGMA user_version')[0].values[0][0], 0);
  },
);
check('otra autoridad no puede adoptar la identidad instalada al reiniciar', async () => {
  const f = await fixture();
  f.database.run("UPDATE sync_state SET authority_id='another-business' WHERE id=1");
  const users = f.database.exec('SELECT * FROM users');
  f.reloadModules();
  await assert.rejects(f.load('@/lib/database').initializeDatabase(), /identidad de recuperación/);
  assert.deepEqual(f.database.exec('SELECT * FROM users'), users);
});
for (const [name, key] of [
  ['ancla segura', IDENTITY_KEY],
  ['testigo', IDENTITY_WITNESS],
]) {
  check(`pérdida del ${name} conserva evidencia y bloquea antes de SQLite`, async () => {
    const f = await fixture();
    f.storage.delete(key);
    const remaining = new Map(f.storage);
    const opens = f.openedDatabaseNames.length;
    f.reloadModules();
    await assert.rejects(
      f.load('@/lib/database').initializeDatabase(),
      /identidad de recuperación/,
    );
    assert.equal(f.openedDatabaseNames.length, opens);
    assert.deepEqual(f.storage, remaining);
  });
}
check('ancla dañada no se reemplaza por una identidad nueva', async () => {
  const f = await fixture();
  f.storage.set(IDENTITY_KEY, 'corrupted');
  f.reloadModules();
  await assert.rejects(f.load('@/lib/database').initializeDatabase(), /identidad de recuperación/);
  assert.equal(f.storage.get(IDENTITY_KEY), 'corrupted');
});
check(
  'reinicio después de confirmar SQLite y antes de anclar mantiene datos y credenciales',
  async () => {
    const f = await fixture();
    const users = f.database.exec('SELECT * FROM users');
    f.storage.set(IDENTITY_KEY, JSON.stringify({ version: 1, phase: 'opening' }));
    f.reloadModules();
    await f.load('@/lib/database').initializeDatabase();
    assert.deepEqual(f.database.exec('SELECT * FROM users'), users);
    assert.equal((await f.load('@/lib/recovery-anchor').loadDatabaseAnchor())?.phase, 'ready');
  },
);
check(
  'instalación v8 anterior sin ancla migra y conserva autoridad, cuentas y cuotas',
  async () => {
    const f = await fixture();
    const users = f.database.exec('SELECT * FROM users');
    const authority = f.database.exec('SELECT authority_id FROM sync_state');
    const usage = await f.db.getDemoUsage();
    stripJournal(f.database);
    f.storage.delete(IDENTITY_KEY);
    f.storage.delete(IDENTITY_WITNESS);
    f.reloadModules();
    const db = f.load('@/lib/database');
    await db.initializeDatabase();
    assert.deepEqual(f.database.exec('SELECT * FROM users'), users);
    assert.deepEqual(f.database.exec('SELECT authority_id FROM sync_state'), authority);
    assert.deepEqual(await db.getDemoUsage(), usage);
    assert.equal((await f.load('@/lib/recovery-anchor').loadDatabaseAnchor())?.phase, 'ready');
  },
);
check('selector con otra autoridad es rechazado por la identidad externa', async () => {
  const f = await fixture();
  await f.restore();
  const key = 'mipypos.recovery.selector.v1';
  const selector = JSON.parse(f.storage.get(key)!);
  f.storage.set(key, JSON.stringify({ ...selector, authorityId: 'another-business' }));
  const opens = f.openedDatabaseNames.length;
  await assert.rejects(
    f.load('@/lib/recovery-selector').resolveDatabaseFile(),
    /identidad del selector/,
  );
  assert.equal(f.openedDatabaseNames.length, opens);
});
check('almacenamiento seguro bloqueado no provoca apertura de una base nueva', async () => {
  const h = createHarness({
    'expo-secure-store': {
      getItemAsync: async () => {
        throw new Error('device locked');
      },
    },
  });
  h.setPrimaryDatabaseExists(false);
  await assert.rejects(h.load('@/lib/database').initializeDatabase(), /Desbloquea el teléfono/);
  assert.equal(h.openedDatabaseNames.length, 0);
});

check('arranque v9 no recrea silenciosamente un journal perdido', async () => {
  const f = await fixture();
  f.database.run('DROP TABLE recovery_journal');
  const users = f.database.exec('SELECT * FROM users');
  await assert.rejects(f.db.initializeDatabase(), /No se creará otro/);
  assert.equal(
    f.database.exec("SELECT name FROM sqlite_master WHERE name='recovery_journal'").length,
    0,
  );
  assert.deepEqual(f.database.exec('SELECT * FROM users'), users);
});
check('arranque v9 detecta pérdida de captura sin repararla ocultando un intervalo', async () => {
  const f = await fixture();
  f.database.run('DROP TRIGGER recovery_capture_products_update');
  await assert.rejects(f.db.initializeDatabase(), /Falta una protección/);
  assert.equal(
    f.database.exec("SELECT name FROM sqlite_master WHERE name='recovery_capture_products_update'")
      .length,
    0,
  );
  assert.equal((await f.db.getProduct(f.product.id))?.stock, 20);
});
check('journal registra efectos y se revierte junto con la venta fallida', async () => {
  const f = await fixture();
  const before = f.database.exec('SELECT * FROM recovery_journal ORDER BY seq');
  f.failWritesContaining('INSERT INTO sale_lines');
  await assert.rejects(f.sale());
  f.failWritesContaining('');
  assert.deepEqual(f.database.exec('SELECT * FROM recovery_journal ORDER BY seq'), before);
  assert.equal((await f.db.getProduct(f.product.id))?.stock, 20);
  assert.equal((await f.db.getAuditSnapshot()).sales.length, 0);
});
check(
  'recuperación conserva recibo LAN y el reintento no descuenta inventario de nuevo',
  async () => {
    const f = await fixture();
    const id = await f.sale();
    const result = await f.restore();
    assert.ok(result.reconciliation.replayEntries > 0);
    assert.equal(await f.sale(), id);
    assert.equal((await f.db.getAuditSnapshot()).sales.length, 1);
    assert.equal((await f.db.getProduct(f.product.id))?.stock, 19);
    assert.equal(await f.db.findNetworkSale('recovery-confirmed-sale', 'terminal-1', 'admin'), id);
  },
);
check('auditoría identifica copia, protección previa y número de cambios conciliados', async () => {
  const f = await fixture();
  await f.sale();
  const result = await f.restore();
  const audit = await (
    await f.db.getDatabase()
  ).getFirstAsync<{ detail: string }>(
    "SELECT detail FROM audit_log WHERE action='recovery.restore' ORDER BY id DESC LIMIT 1",
  );
  assert.ok(audit);
  const detail = JSON.parse(audit.detail);
  assert.equal(detail.policy, 'verified-journal-forward-recovery');
  assert.equal(detail.backupId, f.copy.id);
  assert.equal(detail.safetyBackupId, result.safetyCopy.id);
  assert.equal(detail.replayEntries, result.reconciliation.replayEntries);
});
check('borrado posterior confirmado no resucita una configuración ausente', async () => {
  const f = await fixture();
  f.database.run("INSERT INTO settings(key,value) VALUES('temporary-recovery','original')");
  const copy = await f.db.createPrivateRecoveryBackup('admin', 'admin123');
  f.database.run("DELETE FROM settings WHERE key='temporary-recovery'");
  const result = await f.db.restorePrivateRecoveryBackup('admin', 'admin123', copy.id, true);
  assert.ok(result.reconciliation.replayEntries > 0);
  assert.equal(await f.db.getSetting('temporary-recovery'), null);
});
check(
  'varios cambios sobre la misma clave conservan secuencia y último estado confirmado',
  async () => {
    const f = await fixture();
    await f.db.saveProduct({ ...f.product, price_cash: 120 }, 'admin');
    await f.db.saveProduct({ ...f.product, price_cash: 130 }, 'admin');
    const before = await f.db.listProducts();
    await f.restore();
    assert.deepEqual(await f.db.listProducts(), before);
  },
);
check('journal usa identificadores estables únicos y protege edición y borrado', async () => {
  const f = await fixture();
  const ids = f.database
    .exec('SELECT operation_id FROM recovery_journal')[0]
    .values.map(([id]) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => typeof id === 'string' && /^[0-9a-f]{32}$/.test(id)));
  assert.throws(
    () => f.database.run("UPDATE recovery_journal SET table_name='sales'"),
    /no se modifica/,
  );
  assert.throws(() => f.database.run('DELETE FROM recovery_journal'), /no se elimina/);
  assert.throws(
    () => f.database.run("UPDATE recovery_lineage SET epoch='other'"),
    /no se modifica/,
  );
});
check('copia con operaciones de otra rama no sobrescribe la base actual', async () => {
  const f = await fixture();
  const source = f.backups.get(f.copy.fileName)!;
  source.run('UPDATE products SET price_cash=101');
  await f.sale();
  await assert.rejects(f.restore(), /divergen|no están/);
  assert.equal((await f.db.getProduct(f.product.id))?.price_cash, 100);
  assert.equal((await f.db.getAuditSnapshot()).sales.length, 1);
});
check('prefijo alterado se rechaza aun con autoridad y número de registros iguales', async () => {
  const f = await fixture();
  const source = f.backups.get(f.copy.fileName)!;
  const sql = String(
    source.exec("SELECT sql FROM sqlite_master WHERE name='recovery_journal_no_update'")[0]
      .values[0][0],
  );
  source.run('DROP TRIGGER recovery_journal_no_update');
  source.run('UPDATE recovery_journal SET operation_id=lower(hex(randomblob(16))) WHERE seq=1');
  source.run(sql);
  await f.sale();
  await assert.rejects(f.restore(), /divergen/);
  assert.equal((await f.db.getProduct(f.product.id))?.stock, 19);
});
check('hueco en historial actual bloquea recuperación y conserva original', async () => {
  const f = await fixture();
  await f.sale();
  const sql = String(
    f.database.exec("SELECT sql FROM sqlite_master WHERE name='recovery_journal_no_delete'")[0]
      .values[0][0],
  );
  f.database.run(
    'DROP TRIGGER recovery_journal_no_delete; DELETE FROM recovery_journal WHERE seq=1',
  );
  f.database.run(sql);
  await assert.rejects(f.restore(), /incompleto/);
  assert.equal((await f.db.getAuditSnapshot()).sales.length, 1);
});
check('imagen anterior incompatible no se aplica a una copia alterada', async () => {
  const f = await fixture();
  mutateWithoutCapture(f.backups.get(f.copy.fileName)!, 'products', 'UPDATE products SET stock=18');
  await f.sale();
  await assert.rejects(f.restore(), /estado anterior/);
  assert.equal((await f.db.getProduct(f.product.id))?.stock, 19);
});
check('cambio no registrado en original se detecta en comparación final', async () => {
  const f = await fixture();
  await f.sale();
  mutateWithoutCapture(f.database, 'products', 'UPDATE products SET price_cash=177');
  await assert.rejects(f.restore(), /conciliación final/);
  assert.equal((await f.db.getProduct(f.product.id))?.price_cash, 177);
  assert.equal((await f.db.getAuditSnapshot()).sales.length, 1);
});
check('identidad de historial ajena no se acepta con la misma autoridad LAN', async () => {
  const f = await fixture();
  const source = f.backups.get(f.copy.fileName)!;
  const sql = String(
    source.exec("SELECT sql FROM sqlite_master WHERE name='recovery_lineage_no_update'")[0]
      .values[0][0],
  );
  source.run("DROP TRIGGER recovery_lineage_no_update; UPDATE recovery_lineage SET epoch='other'");
  source.run(sql);
  await f.sale();
  await assert.rejects(f.restore(), /no comparten/);
});
check('journal paginado concilia más de una página sin perder orden', async () => {
  const f = await fixture();
  for (let index = 0; index < 520; index += 1)
    f.database.run('INSERT INTO settings(key,value) VALUES(?,?)', [
      `recovery-page-${index}`,
      String(index),
    ]);
  const result = await f.restore();
  assert.equal(result.reconciliation.replayEntries, 520);
  assert.equal(await f.db.getSetting('recovery-page-519'), '519');
});
check(
  'copia anterior se puede recuperar repetidamente sin nuevas ventas ni movimientos',
  async () => {
    const f = await fixture();
    await f.sale();
    await f.restore();
    const before = await f.db.getAuditSnapshot();
    const products = await f.db.listProducts();
    await f.restore();
    assert.deepEqual((await f.db.getAuditSnapshot()).sales, before.sales);
    assert.deepEqual((await f.db.getAuditSnapshot()).movements, before.movements);
    assert.deepEqual(await f.db.listProducts(), products);
    assert.equal(await f.sale(), before.sales[0].id);
  },
);
check('triggers comerciales e inmutabilidad se reinstalan después de recuperar', async () => {
  const f = await fixture();
  await f.sale();
  await f.restore();
  const active = await f.db.getDatabase();
  await assert.rejects(active.runAsync('DELETE FROM recovery_journal'), /no se elimina/);
  const size = (await active.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM recovery_journal',
  ))!.n;
  await f.db.saveProduct({ ...f.product, stock: 19, price_cash: 122 }, 'admin');
  assert.ok(
    (await active.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM recovery_journal'))!.n >
      size,
  );
});
for (const stage of [
  'candidate-copy',
  'candidate-reopen',
  'selector-prepared',
  'selector-committed',
  'selector-committed-readback',
  'close-active',
] as const) {
  check(`interrupción ${stage} al conciliar copia antigua conserva venta y recibo`, async () => {
    const f = await fixture();
    const id = await f.sale();
    f.failRecoveryStageOnce(stage);
    await assert.rejects(f.restore(), /Injected recovery failure/);
    assert.equal((await f.db.getProduct(f.product.id))?.stock, 19);
    assert.equal((await f.db.getAuditSnapshot()).sales.length, 1);
    assert.equal(await f.sale(), id);
    assert.ok(f.backups.has(f.copy.fileName));
  });
}
check('migración v8 a v9 conserva datos, cuentas, licencia y copia previa', async () => {
  const f = await fixture();
  await f.sale();
  stripJournal(f.database);
  const before = f.database.exec('SELECT * FROM products');
  const users = f.database.exec('SELECT * FROM users');
  const settings = f.database.exec(
    "SELECT * FROM settings WHERE key IN ('license_mode','usage_sales','usage_products') ORDER BY key",
  );
  await f.db.initializeDatabase();
  assert.deepEqual(f.database.exec('SELECT * FROM products'), before);
  assert.deepEqual(f.database.exec('SELECT * FROM users'), users);
  assert.deepEqual(
    f.database.exec(
      "SELECT * FROM settings WHERE key IN ('license_mode','usage_sales','usage_products') ORDER BY key",
    ),
    settings,
  );
  assert.equal(f.database.exec('PRAGMA user_version')[0].values[0][0], 9);
  assert.equal(f.backups.get('mipypos.pre-v8.db')!.exec('PRAGMA user_version')[0].values[0][0], 8);
});
check(
  'fallo de migración v9 no deja journal parcial ni cambia versión o credenciales',
  async () => {
    const f = await fixture();
    stripJournal(f.database);
    const before = f.database.exec('SELECT * FROM users');
    f.failWritesContaining('INSERT OR IGNORE INTO recovery_lineage');
    await assert.rejects(f.db.initializeDatabase());
    f.failWritesContaining('');
    assert.deepEqual(f.database.exec('SELECT * FROM users'), before);
    assert.equal(f.database.exec('PRAGMA user_version')[0].values[0][0], 8);
    assert.equal(
      f.database.exec("SELECT name FROM sqlite_master WHERE name='recovery_journal'").length,
      0,
    );
    await f.db.initializeDatabase();
    assert.equal(f.database.exec('PRAGMA user_version')[0].values[0][0], 9);
  },
);
async function legacyCopy(f: Awaited<ReturnType<typeof fixture>>) {
  const source = f.backups.get(f.copy.fileName)!;
  stripJournal(source);
  f.database.run('UPDATE settings SET value=? WHERE key=?', [
    JSON.stringify({ ...f.copy, schemaVersion: 8 }),
    `private_backup:${f.copy.id}`,
  ]);
}
check('copia v8 compatible se restaura sin modificar su archivo fuente', async () => {
  const f = await fixture();
  await legacyCopy(f);
  const source = f.backups.get(f.copy.fileName)!;
  const original = source.export();
  await f.restore();
  assert.deepEqual(source.export(), original);
  assert.equal((await f.db.getProduct(f.product.id))?.stock, 20);
  assert.ok(await f.db.authenticate('admin', 'admin123'));
});
check('copia v8 divergente sigue bloqueada por ausencia de evidencia retrospectiva', async () => {
  const f = await fixture();
  await legacyCopy(f);
  await f.sale();
  await assert.rejects(f.restore(), /v8 difiere/);
  assert.equal((await f.db.getProduct(f.product.id))?.stock, 19);
  assert.equal(await f.db.getLicenseMode(), 'demo');
});

check('comprobación previa muestra recuperación posterior sin modificar la copia', async () => {
  const f = await fixture();
  const source = f.backups.get(f.copy.fileName)!;
  const before = source.export();
  await f.sale();
  const result = await f.db.inspectPrivateRecoveryBackup('admin', 'admin123', f.copy.id);
  assert.equal(result.recovery?.status, 'forward');
  assert.ok(result.recovery.replayEntries > 0);
  assert.deepEqual(source.export(), before);
  assert.equal(f.storage.has('mipypos.recovery.selector.v1'), false);
});
check('comprobación previa distingue integridad de copia y bloqueo por divergencia', async () => {
  const f = await fixture();
  await legacyCopy(f);
  await f.sale();
  const result = await f.db.inspectPrivateRecoveryBackup('admin', 'admin123', f.copy.id);
  assert.equal(result.sales, 0);
  assert.equal(result.recovery?.status, 'blocked');
  assert.match(result.recovery?.reason ?? '', /v8 difiere/);
});
check(
  'conciliación conserva consumo, anulación y efectos únicos en inventario y caja',
  async () => {
    const f = await fixture();
    const authorization = { username: 'admin', password: 'admin123' };
    await f.db.setProductCost(
      { commandId: 'recovery-cost', productId: f.product.id, cost: 40, reason: 'Costo registrado' },
      'admin',
    );
    const input = {
      commandId: 'recovery-consumption',
      productId: f.product.id,
      areaId: f.area.id,
      quantity: 2,
      reason: 'Uso interno',
      notes: '',
      authorization,
    };
    await f.db.registerConsumption(input, 'admin');
    await f.db.cancelConsumption(
      {
        id: input.commandId,
        commandId: 'recovery-consumption-void',
        reason: 'Registro equivocado',
        authorization,
      },
      'admin',
    );
    const data = await f.db.getConsumptionData('admin');
    const cash = await f.db.getCashSummary(f.session);
    await f.restore();
    assert.deepEqual(await f.db.getConsumptionData('admin'), data);
    assert.deepEqual(await f.db.getCashSummary(f.session), cash);
    assert.equal((await f.db.getProduct(f.product.id))?.stock, 20);
    await f.db.registerConsumption(input, 'admin');
    assert.equal((await f.db.getProduct(f.product.id))?.stock, 20);
  },
);
check('conciliación conserva costo vendido histórico, devolución y rentabilidad', async () => {
  const f = await fixture();
  const authorization = { username: 'admin', password: 'admin123' };
  await f.db.setProductCost(
    {
      commandId: 'recovery-cost-sale',
      productId: f.product.id,
      cost: 40,
      reason: 'Costo registrado',
    },
    'admin',
  );
  const saleId = await f.sale();
  const adjustment = {
    commandId: 'recovery-return',
    saleId,
    kind: 'anulacion' as const,
    reason: 'Venta anulada',
    authorization,
  };
  await f.db.registerSaleAdjustment(adjustment, 'admin');
  const filter = { start: '2000-01-01T00:00:00.000Z', end: '2099-12-31T23:59:59.999Z' };
  const report = await f.db.getFinanceReport(filter, 'admin');
  const assertReportUnchanged = async () => {
    const current = await f.db.getFinanceReport(filter, 'admin');
    // asOf is the query timestamp, not a stored business field. Validate its
    // progression separately while comparing every amount, unit and snapshot.
    assert.ok(Date.parse(current.inventory.asOf) >= Date.parse(report.inventory.asOf));
    assert.deepEqual(
      { ...current, inventory: { ...current.inventory, asOf: report.inventory.asOf } },
      report,
    );
  };
  const cash = await f.db.getCashSummary(f.session);
  await f.restore();
  await assertReportUnchanged();
  assert.deepEqual(await f.db.getCashSummary(f.session), cash);
  assert.equal((await f.db.getProduct(f.product.id))?.stock, 20);
  await f.db.registerSaleAdjustment(adjustment, 'admin');
  await assertReportUnchanged();
});
check(
  'conciliación fiscal preserva perfil y provisión sin duplicar registros ni debilitar inmutabilidad',
  async () => {
    const f = await fixture();
    await f.db.executeFiscalCommand(
      {
        action: 'profile',
        commandId: 'recovery-fiscal-profile',
        value: {
          taxpayerId: 'recovery-taxpayer',
          name: 'Perfil de prueba de recuperación',
          nit: 'TEST-RECOVERY',
          category: 'TCP',
          province: 'La Habana',
          municipality: 'Plaza',
          address: 'Dirección de prueba',
          activity: 'Comercio',
          secondaryActivities: '',
          regime: 'Prueba de recuperación',
          startDate: '2020-01-01',
          fiscalPeriod: 'Año',
          registration: '',
          accountant: 'Responsable de prueba',
          source: 'POS',
          reservePercent: 0,
          reserveBase: 'Ingresos',
          effectiveFrom: '2020-01-01',
        },
      },
      'admin',
    );
    const command = {
      action: 'record' as const,
      commandId: 'recovery-fiscal-provision',
      value: {
        taxpayerId: 'recovery-taxpayer',
        kind: 'provision' as const,
        date: '2026-10-01',
        amount: 12,
        reference: '',
        operationCode: '',
        account: '',
        method: 'Efectivo' as const,
        notes: 'Provisión de prueba, no pago',
        obligationId: null,
        beneficiary: '',
        deductionRuleId: null,
        attachment: null,
        attachmentName: '',
      },
    };
    await f.db.executeFiscalCommand(command, 'admin');
    const filter = { taxpayerId: 'recovery-taxpayer', start: '2026-10-01', end: '2026-10-31' };
    const data = await f.db.getFiscalData(filter, 'admin');
    await f.restore();
    assert.deepEqual(await f.db.getFiscalData(filter, 'admin'), data);
    await f.db.executeFiscalCommand(command, 'admin');
    assert.deepEqual(await f.db.getFiscalData(filter, 'admin'), data);
    await assert.rejects((await f.db.getDatabase()).runAsync('DELETE FROM fiscal_records'), /./);
  },
);
