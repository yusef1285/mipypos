'use strict';
// HTTPS host compatible with MipyTlsModule.java (LAN protocol 4). Requests are handed to
// the renderer, where the shared TypeScript host (lib/network/host.ts) answers them.
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const { certificateFor, privateIp, verifyPeer } = require('./lan-identity.cjs');

const LIMIT = 1024 * 1024;
const MAX_WAITERS = 32;
const PORT = 8787;
const REPLY_TIMEOUT = 20000;
const PIN = /^[A-Za-z0-9+/]{43}=$/;

class LanServer {
  /** @param {{ loadKey: () => crypto.KeyObject, emit: (request: object) => void }} options */
  constructor(options) {
    this.options = options;
    this.server = null;
    this.ip = null;
    this.pin = null;
    this.replies = new Map();
  }

  async start(ip, port) {
    if (port !== PORT || !privateIp(ip)) throw new Error('Dirección LAN no válida');
    if (this.server && this.ip === ip) return this.pin;
    await this.stop();
    const identity = certificateFor(this.options.loadKey(), ip);
    const server = https.createServer(
      {
        key: identity.keyPem,
        cert: identity.certPem,
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.2',
        requestTimeout: 30000,
        headersTimeout: 10000,
      },
      (request, response) => void this.handle(request, response),
    );
    server.maxHeadersCount = 40;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, ip, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
    this.ip = ip;
    this.pin = identity.pin;
    return this.pin;
  }

  async stop() {
    const server = this.server;
    this.server = null;
    this.ip = null;
    this.pin = null;
    for (const reply of this.replies.values()) reply.reject(new Error('Servidor detenido'));
    this.replies.clear();
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(() => resolve()));
    }
  }

  respond(id, body) {
    const reply = this.replies.get(id);
    if (reply && typeof body === 'string') reply.resolve(body);
  }

  async handle(request, response) {
    const send = (status, body = '{}') => {
      if (response.headersSent) return;
      response.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body),
      });
      response.end(body);
    };
    const id = crypto.randomUUID();
    try {
      if (this.replies.size >= MAX_WAITERS) return send(503);
      const method = request.method;
      let body = '{}';
      if (method === 'POST') {
        const size = Number(request.headers['content-length'] ?? 0);
        if (!Number.isSafeInteger(size) || size <= 0 || size > LIMIT) return send(400);
        body = await readBody(request, size);
      } else if (method !== 'GET') return send(405);
      const path = new URL(request.url ?? '/', 'https://lan.invalid').pathname;
      const reply = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Tiempo agotado')), REPLY_TIMEOUT);
        this.replies.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
      });
      this.options.emit({ id, method, path, body });
      send(200, await reply);
    } catch {
      send(503);
    } finally {
      this.replies.delete(id);
    }
  }
}

function readBody(request, size) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > size || total > LIMIT) {
        request.destroy();
        reject(new Error('Cuerpo demasiado grande'));
      } else chunks.push(chunk);
    });
    request.on('end', () =>
      total === size ? resolve(Buffer.concat(chunks).toString('utf8')) : reject(new Error('EOF')),
    );
    request.on('error', reject);
  });
}

/** Pinned HTTPS request to another MipyPOS host (desktop acting as a terminal). */
function pinnedRequest(address, method, body, expectedPin) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(address);
      if (
        url.protocol !== 'https:' ||
        url.port !== String(PORT) ||
        !privateIp(url.hostname) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        !url.pathname.startsWith('/v1/') ||
        (method !== 'GET' && method !== 'POST') ||
        !PIN.test(expectedPin) ||
        Buffer.byteLength(body ?? '') > LIMIT
      )
        throw new Error('Solicitud LAN no válida');
    } catch (error) {
      reject(error);
      return;
    }
    const fail = () =>
      reject(
        new Error(
          'No se pudo confirmar la conexión segura. Revisa la red, la fecha y el QR del administrador.',
        ),
      );
    const socket = tls.connect({
      host: url.hostname,
      port: PORT,
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
      maxVersion: 'TLSv1.2',
    });
    socket.setTimeout(25000, () => socket.destroy(new Error('Tiempo agotado')));
    socket.once('error', fail);
    socket.once('secureConnect', () => {
      try {
        // Verify before any request byte leaves this computer.
        verifyPeer(socket, expectedPin);
      } catch (error) {
        if (process.env.MIPY_DEBUG) console.error(error);
        socket.destroy();
        fail();
        return;
      }
      const payload = method === 'POST' ? Buffer.from(body, 'utf8') : null;
      const request = http.request(
        {
          createConnection: () => socket,
          method,
          path: url.pathname,
          headers: {
            Host: `${url.hostname}:${PORT}`,
            'Content-Type': 'application/json',
            ...(payload ? { 'Content-Length': payload.length } : {}),
          },
        },
        (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            socket.destroy();
            fail();
            return;
          }
          const chunks = [];
          let total = 0;
          response.on('data', (chunk) => {
            total += chunk.length;
            if (total > LIMIT) {
              socket.destroy();
              fail();
            } else chunks.push(chunk);
          });
          response.on('end', () => {
            socket.end();
            resolve(Buffer.concat(chunks).toString('utf8'));
          });
          response.on('error', fail);
        },
      );
      request.on('error', fail);
      if (payload) request.write(payload);
      request.end();
    });
  });
}

module.exports = { LanServer, pinnedRequest, PORT };
