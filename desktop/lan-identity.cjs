'use strict';
// Same certificate layout as lib/network/native/LanIdentity.java: a stable EC P-256 key
// (pinned by the phones through the QR) and a fresh self-signed leaf with the current IP SAN.
const crypto = require('node:crypto');

function der(tag, value) {
  const length = value.length;
  let header;
  if (length < 128) header = Buffer.from([tag, length]);
  else if (length < 256) header = Buffer.from([tag, 0x81, length]);
  else header = Buffer.from([tag, 0x82, length >> 8, length & 0xff]);
  return Buffer.concat([header, value]);
}
const seq = (...values) => der(0x30, Buffer.concat(values));

const pad = (n) => String(n).padStart(2, '0');
function utc(date) {
  const text =
    pad(date.getUTCFullYear() % 100) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z';
  return der(0x17, Buffer.from(text, 'ascii'));
}

function positiveInteger(bytes) {
  let value = Buffer.from(bytes);
  while (value.length > 1 && value[0] === 0 && value[1] < 0x80) value = value.subarray(1);
  if (value[0] >= 0x80) value = Buffer.concat([Buffer.from([0]), value]);
  return der(0x02, value);
}

function privateIp(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4 || parts.some((part) => !/^[0-9]{1,3}$/.test(part))) return false;
  const n = parts.map(Number);
  if (n.some((value) => value > 255)) return false;
  return (
    n[0] === 10 || (n[0] === 192 && n[1] === 168) || (n[0] === 172 && n[1] >= 16 && n[1] <= 31)
  );
}

/** base64(SHA-256(SubjectPublicKeyInfo DER)), identical to LanIdentity.pin(). */
function pinOf(publicKey) {
  return crypto
    .createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64');
}

function generateKey() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
}

function certificateFor(privateKey, ip, now = Date.now()) {
  if (!privateIp(ip)) throw new Error('Dirección LAN no válida');
  const publicKey = crypto.createPublicKey(privateKey);
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const algorithm = seq(der(0x06, Buffer.from([42, 134, 72, 206, 61, 4, 3, 2])));
  const name = seq(
    der(
      0x31,
      seq(der(0x06, Buffer.from([85, 4, 3])), der(0x0c, Buffer.from('MipyPOS LAN', 'utf8'))),
    ),
  );
  const address = Buffer.from(ip.split('.').map(Number));
  const san = seq(der(0x06, Buffer.from([85, 29, 17])), der(0x04, seq(der(0x87, address))));
  const serial = crypto.randomBytes(16);
  serial[0] |= 0x01;
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([2]))),
    positiveInteger(serial),
    algorithm,
    name,
    seq(utc(new Date(now - 86400000)), utc(new Date(now + 365 * 86400000))),
    name,
    spki,
    der(0xa3, seq(san)),
  );
  const signature = crypto.sign('sha256', tbs, { key: privateKey, dsaEncoding: 'der' });
  const certificate = seq(tbs, algorithm, der(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const x509 = new crypto.X509Certificate(certificate);
  if (!x509.verify(publicKey)) throw new Error('Certificado LAN inválido');
  return {
    certPem: x509.toString(),
    keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    pin: pinOf(publicKey),
  };
}

/** Pinned verification used by the desktop client (mirrors MipyTlsModule.checkServerTrusted). */
function verifyPeer(socket, expectedPin) {
  const detail = socket.getPeerCertificate(true);
  if (!detail || !detail.raw) throw new Error('Certificado del administrador no válido');
  const peer = new crypto.X509Certificate(detail.raw);
  // Self-signed leaf only: a chain longer than one certificate is rejected.
  if (detail.issuerCertificate && detail.issuerCertificate !== detail) {
    const issuer = detail.issuerCertificate;
    if (!issuer.raw || !Buffer.from(issuer.raw).equals(Buffer.from(detail.raw)))
      throw new Error('Certificado del administrador no válido');
  }
  const pin = pinOf(peer.publicKey);
  const a = Buffer.from(pin, 'ascii');
  const b = Buffer.from(expectedPin, 'ascii');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    throw new Error('La identidad del administrador ha cambiado');
  const now = Date.now();
  if (now < Date.parse(peer.validFrom) || now > Date.parse(peer.validTo))
    throw new Error('Certificado del administrador vencido');
  if (!peer.verify(peer.publicKey)) throw new Error('Certificado del administrador no válido');
  const host = socket.servername || socket.remoteAddress;
  if (socket.remoteAddress && !peer.checkIP(socket.remoteAddress.replace(/^::ffff:/, '')))
    throw new Error(`El certificado no corresponde a ${host}`);
}

module.exports = { der, seq, privateIp, pinOf, generateKey, certificateFor, verifyPeer };
