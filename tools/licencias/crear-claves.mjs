#!/usr/bin/env node
// Crea un par de claves Ed25519 para firmar licencias. Solo necesario la
// primera vez o para rotar la clave. Nunca sobrescribe una clave existente.
import { createHash, generateKeyPairSync } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, process.argv[2] ?? 'mipypos-licencias-privada.pem');
if (existsSync(target)) {
  console.error(`Ya existe ${target}. No se sobrescribe: muévela antes si quieres rotar la clave.`);
  process.exit(1);
}
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
writeFileSync(target, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
const x = publicKey.export({ format: 'jwk' }).x;
const kid = createHash('sha256').update(Buffer.from(x, 'base64url')).digest('hex').slice(0, 8);
console.log(`Clave privada: ${target}  (guárdala en un lugar seguro, nunca la compartas)`);
console.log('Agrega esta línea a lib/license-keys.ts y recompila la app:');
console.log(`  '${kid}': '${x}',`);
