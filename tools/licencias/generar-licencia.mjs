#!/usr/bin/env node
// Generador externo de licencias MipyPOS (formato MIPY1, Ed25519).
// Requiere solo Node.js 18 o superior; no usa dependencias.
// Uso:
//   node generar-licencia.mjs --plan trial|monthly|annual|custom [--days N]
//        [--device XXXX-XXXX-XXXX-XXXX] [--customer "Nombre"] [--key ruta.pem]
//        [--start AAAA-MM-DD] [--out archivo.txt]
import { createHash, createPrivateKey, createPublicKey, randomUUID, sign } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PLAN_DAYS = { trial: 7, monthly: 30, annual: 365 };
const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith('--')) fail(`Argumento inesperado: ${item}`);
    const name = item.slice(2);
    const next = argv[i + 1];
    out[name] = next && !next.startsWith('--') ? (i++, next) : true;
  }
  return out;
}

// JSON with non-ASCII escaped, so the app can decode it byte by byte.
const asciiJson = (value) =>
  JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );

const opts = args(process.argv.slice(2));
if (opts.help || opts.h) {
  console.log(readFileSync(join(here, 'LEEME.md'), 'utf8'));
  process.exit(0);
}
const plan = opts.plan ?? 'trial';
if (!['trial', 'monthly', 'annual', 'custom'].includes(plan))
  fail('El plan debe ser trial, monthly, annual o custom.');
const days = plan === 'custom' ? Number(opts.days) : Number(opts.days ?? PLAN_DAYS[plan]);
if (!Number.isInteger(days) || days < 1 || days > 3660) fail('Indica --days entre 1 y 3660.');
const device = opts.device ? String(opts.device).trim().toUpperCase() : undefined;
if (device && !/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/.test(device))
  fail('El código de dispositivo tiene la forma XXXX-XXXX-XXXX-XXXX (lo ves en Configuración).');
const customer = opts.customer ? String(opts.customer).trim().slice(0, 120) : '';

const keyPath = resolve(String(opts.key ?? join(here, 'mipypos-licencias-privada.pem')));
if (!existsSync(keyPath))
  fail(`No se encontró la clave privada en ${keyPath}. Usa --key o crear-claves.`);
const privateKey = createPrivateKey(readFileSync(keyPath));
if (privateKey.asymmetricKeyType !== 'ed25519') fail('La clave privada no es Ed25519.');
const rawPublic = Buffer.from(createPublicKey(privateKey).export({ format: 'jwk' }).x, 'base64url');
const kid = createHash('sha256').update(rawPublic).digest('hex').slice(0, 8);

const start = opts.start ? new Date(`${opts.start}T00:00:00`) : new Date();
if (Number.isNaN(start.getTime())) fail('La fecha --start debe ser AAAA-MM-DD.');
const expires = new Date(start.getTime() + days * 86_400_000);
const payload = {
  v: 1,
  kid,
  id: randomUUID(),
  plan,
  customer,
  ...(device ? { device } : {}),
  iat: start.toISOString(),
  exp: expires.toISOString(),
};
const body = `MIPY1.${Buffer.from(asciiJson(payload), 'latin1').toString('base64url')}`;
const signature = sign(null, Buffer.from(body, 'utf8'), privateKey).toString('base64url');
const token = `${body}.${signature}`;

const summary = [
  `Plan: ${plan} (${days} días)`,
  `Cliente: ${customer || '(sin nombre)'}`,
  `Dispositivo: ${device ?? 'cualquiera'}`,
  `Válida desde: ${payload.iat}`,
  `Vence: ${payload.exp}`,
  `ID: ${payload.id}`,
  '',
  token,
].join('\n');
console.log(summary);
if (opts.out) writeFileSync(resolve(String(opts.out)), `${summary}\n`);
// Local register of issued licenses (never shipped with the app).
appendFileSync(
  join(dirname(keyPath), 'licencias-emitidas.csv'),
  `${new Date().toISOString()},${payload.id},${plan},${days},"${customer.replaceAll('"', "'")}",${device ?? ''},${payload.exp}\n`,
);
