'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const test = require('node:test');
const { certificateFor, generateKey, pinOf, privateIp } = require('../lan-identity.cjs');
const { LanServer, pinnedRequest } = require('../lan-server.cjs');

const ip =
  process.env.MIPY_TEST_IP ||
  Object.values(os.networkInterfaces())
    .flat()
    .find((item) => item && item.family === 'IPv4' && !item.internal && privateIp(item.address))
    ?.address;

void test('certificate matches the Android layout and pin', () => {
  const key = generateKey();
  const identity = certificateFor(key, '192.168.1.20');
  const cert = new crypto.X509Certificate(identity.certPem);
  assert.equal(cert.subject, 'CN=MipyPOS LAN');
  assert.equal(cert.issuer, 'CN=MipyPOS LAN');
  assert.ok(cert.checkIP('192.168.1.20'));
  assert.ok(cert.verify(cert.publicKey));
  assert.match(identity.pin, /^[A-Za-z0-9+/]{43}=$/);
  assert.equal(identity.pin, pinOf(crypto.createPublicKey(key)));
  // Same key on a new IP keeps the pin the phones scanned.
  assert.equal(certificateFor(key, '10.0.0.5').pin, identity.pin);
  assert.throws(() => certificateFor(key, '8.8.8.8'));
});

void test(
  'pinned round trip through the renderer bridge',
  { skip: !ip && 'sin IP privada' },
  async () => {
    const key = generateKey();
    let server;
    server = new LanServer({
      loadKey: () => key,
      emit: (request) =>
        setImmediate(() =>
          server.respond(
            request.id,
            JSON.stringify({ ok: true, echo: request.path, body: JSON.parse(request.body) }),
          ),
        ),
    });
    const pin = await server.start(ip, 8787);
    try {
      const reply = JSON.parse(
        await pinnedRequest(`https://${ip}:8787/v1/sale`, 'POST', '{"a":1}', pin),
      );
      assert.deepEqual(reply, { ok: true, echo: '/v1/sale', body: { a: 1 } });
      const health = JSON.parse(
        await pinnedRequest(`https://${ip}:8787/v1/health`, 'GET', '', pin),
      );
      assert.equal(health.echo, '/v1/health');
      const other = pinOf(crypto.createPublicKey(generateKey()));
      await assert.rejects(pinnedRequest(`https://${ip}:8787/v1/health`, 'GET', '', other));
      await assert.rejects(pinnedRequest(`https://8.8.8.8:8787/v1/health`, 'GET', '', pin));
      await assert.rejects(pinnedRequest(`https://${ip}:8787/other`, 'GET', '', pin));
    } finally {
      await server.stop();
    }
  },
);

void test(
  'server answers 503 when the renderer does not reply',
  { skip: !ip && 'sin IP privada' },
  async () => {
    const key = generateKey();
    const server = new LanServer({ loadKey: () => key, emit: () => undefined });
    const pin = await server.start(ip, 8787);
    const started = Date.now();
    const pending = pinnedRequest(`https://${ip}:8787/v1/health`, 'GET', '', pin);
    setTimeout(() => void server.stop(), 300);
    await assert.rejects(pending);
    assert.ok(Date.now() - started < 5000);
  },
);
