'use strict';
// MipyPOS para Windows: ventana Electron que ejecuta la versión web de MipyPOS y aporta
// lo que en Android dan los módulos nativos (servidor LAN seguro, mDNS, secretos, copias).
const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  safeStorage,
  shell,
} = require('electron');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { generateKey, privateIp } = require('./lan-identity.cjs');
const { LanServer, pinnedRequest } = require('./lan-server.cjs');

const SCHEME = 'app';
const ORIGIN = `${SCHEME}://mipypos`;
const WEB_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'web')
  : path.resolve(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      codeCache: true,
    },
  },
]);

if (!app.requestSingleInstanceLock()) {
  // Two windows would write the same database; keep a single MipyPOS per Windows user.
  app.quit();
}

let mainWindow = null;
const userData = () => app.getPath('userData');

// ---------- encrypted local files (DPAPI through safeStorage) ----------
function encrypt(text) {
  if (safeStorage.isEncryptionAvailable())
    return Buffer.concat([Buffer.from('E1'), safeStorage.encryptString(text)]);
  if (process.platform === 'win32')
    throw new Error('Windows no permite proteger los datos de MipyPOS.');
  return Buffer.concat([Buffer.from('P1'), Buffer.from(text, 'utf8')]);
}
function decrypt(buffer) {
  const tag = buffer.subarray(0, 2).toString();
  if (tag === 'E1') return safeStorage.decryptString(buffer.subarray(2));
  if (tag === 'P1' && process.platform !== 'win32') return buffer.subarray(2).toString('utf8');
  throw new Error('Archivo protegido no válido.');
}
function writeAtomic(file, data) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, data, { mode: 0o600 });
  fs.renameSync(temp, file);
}

const secretsFile = () => path.join(userData(), 'secrets.bin');
let secretsCache = null;
function secrets() {
  if (secretsCache) return secretsCache;
  try {
    secretsCache = JSON.parse(decrypt(fs.readFileSync(secretsFile())));
  } catch (error) {
    if (error.code !== 'ENOENT' && fs.existsSync(secretsFile()))
      fs.renameSync(secretsFile(), `${secretsFile()}.danado-${Date.now()}`);
    secretsCache = {};
  }
  return secretsCache;
}
function saveSecrets() {
  writeAtomic(secretsFile(), encrypt(JSON.stringify(secretsCache ?? {})));
}

function loadLanKey() {
  const file = path.join(userData(), 'lan-identity.bin');
  if (fs.existsSync(file)) return crypto.createPrivateKey(decrypt(fs.readFileSync(file)));
  const key = generateKey();
  writeAtomic(file, encrypt(key.export({ type: 'pkcs8', format: 'pem' })));
  return key;
}

// ---------- device id for licenses ----------
let deviceIdCache = null;
function deviceId() {
  if (deviceIdCache) return Promise.resolve(deviceIdCache);
  const fallback = () => {
    const stored = secrets()['mipypos.desktop.deviceId'];
    if (stored) return stored;
    const value = crypto.randomUUID();
    secrets()['mipypos.desktop.deviceId'] = value;
    saveSecrets();
    return value;
  };
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve((deviceIdCache = fallback()));
    execFile(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'],
      { windowsHide: true, timeout: 5000 },
      (error, stdout) => {
        const match = !error && /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/.exec(stdout);
        // The raw GUID never leaves the computer: the license only sees its hash.
        deviceIdCache = match
          ? crypto
              .createHash('sha256')
              .update(`mipypos:${match[1].toLowerCase()}`)
              .digest('hex')
              .slice(0, 32)
          : fallback();
        resolve(deviceIdCache);
      },
    );
  });
}

// ---------- network ----------
function hostIp() {
  // Development only: lets automated tests bind a private alias on a loopback interface.
  if (!app.isPackaged && process.env.MIPY_LAN_IP && privateIp(process.env.MIPY_LAN_IP))
    return process.env.MIPY_LAN_IP;
  const candidates = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family !== 'IPv4' || item.internal || !privateIp(item.address)) continue;
      const virtual = /vmware|virtual|vbox|hyper-v|vethernet|docker|wsl|tailscale|zerotier/i.test(
        name,
      );
      const score =
        (virtual ? 10 : 0) +
        (/wi-?fi|wlan|inal/i.test(name) ? 0 : 1) +
        (item.address.startsWith('192.168.') ? 0 : 2);
      candidates.push({ address: item.address, score });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.address ?? null;
}

const lan = new LanServer({
  loadKey: loadLanKey,
  emit: (request) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('mipy:tls-request', request);
  },
});

let bonjour = null;
let advertised = null;
async function advertise(identity, port) {
  await stopAdvertising();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(identity))) throw new Error('Identidad no válida');
  const { Bonjour } = require('bonjour-service');
  bonjour = new Bonjour();
  advertised = bonjour.publish({
    name: `MipyPOS-${identity}`,
    type: 'mipypos',
    protocol: 'tcp',
    port,
  });
}
async function stopAdvertising() {
  if (advertised) await new Promise((resolve) => advertised.stop?.(resolve) ?? resolve());
  advertised = null;
  if (bonjour) bonjour.destroy();
  bonjour = null;
}

// ---------- backups ----------
function backupFolder() {
  const folder = path.join(app.getPath('documents'), 'MipyPOS', 'Copias');
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

// ---------- IPC ----------
function trusted(event) {
  // Node reports origin "null" for custom schemes, so compare scheme and host explicitly.
  if (!event.senderFrame) return false;
  const url = new URL(event.senderFrame.url);
  return url.protocol === `${SCHEME}:` && url.host === 'mipypos';
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trusted(event)) throw new Error('Origen no permitido');
    return fn(...args);
  });
}
handle('mipy:tls-start', (ip, port) => lan.start(String(ip), Number(port)));
handle('mipy:tls-stop', () => lan.stop());
handle('mipy:tls-request', (url, method, body, pin) =>
  pinnedRequest(String(url), String(method), String(body), String(pin)),
);
ipcMain.on('mipy:tls-respond', (event, id, body) => {
  if (trusted(event)) lan.respond(String(id), String(body));
});
handle('mipy:host-ip', () => hostIp());
handle('mipy:advertise', (identity, port) => advertise(identity, Number(port)));
handle('mipy:advertise-stop', () => stopAdvertising());
handle('mipy:secret-get', (key) => secrets()[String(key)] ?? null);
handle('mipy:secret-set', (key, value) => {
  secrets()[String(key)] = String(value);
  saveSecrets();
});
handle('mipy:secret-remove', (key) => {
  delete secrets()[String(key)];
  saveSecrets();
});
handle('mipy:device-id', () => deviceId());
handle('mipy:backup-folder', () => backupFolder());
handle('mipy:backup-save', (name, contents) => {
  const safe = String(name).replace(/[^A-Za-z0-9._-]/g, '_');
  if (!safe.endsWith('.json') || safe.length > 120) throw new Error('Nombre de copia no válido');
  const file = path.join(backupFolder(), safe);
  writeAtomic(file, String(contents));
  return file;
});
handle('mipy:backup-list', () =>
  fs
    .readdirSync(backupFolder())
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      const stat = fs.statSync(path.join(backupFolder(), name));
      return { name, size: stat.size, modifiedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    .slice(0, 50),
);
handle('mipy:backup-pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecciona el archivo de cierre de MipyPOS',
    defaultPath: backupFolder(),
    filters: [{ name: 'Cierre MipyPOS', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const stat = fs.statSync(result.filePaths[0]);
  if (stat.size > 150 * 1024 * 1024) throw new Error('El archivo supera los 150 MB permitidos.');
  return fs.readFileSync(result.filePaths[0], 'utf8');
});
handle('mipy:backup-open', () => shell.openPath(backupFolder()).then(() => undefined));

// ---------- window ----------
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};
function serveApp() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let file = path.resolve(WEB_ROOT, relative);
    if (!file.startsWith(WEB_ROOT + path.sep) && file !== WEB_ROOT)
      return new Response('', { status: 403 });
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      const html = `${file}.html`;
      file = fs.existsSync(html) ? html : path.join(WEB_ROOT, 'index.html');
    }
    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set(
      'Content-Type',
      TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    );
    // Needed by expo-sqlite (SharedArrayBuffer + OPFS) exactly like the web build.
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    headers.set('Cache-Control', 'no-cache');
    return new Response(response.body, { status: 200, headers });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'MipyPOS',
    backgroundColor: '#ffffff',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(ORIGIN)) event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(['clipboard-sanitized-write', 'notifications'].includes(permission)),
  );
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  void mainWindow.loadURL(`${ORIGIN}/`);
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

void app.whenReady().then(() => {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'MipyPOS',
        submenu: [
          { label: 'Abrir carpeta de copias', click: () => void shell.openPath(backupFolder()) },
          { type: 'separator' },
          { role: 'reload', label: 'Recargar' },
          { role: 'togglefullscreen', label: 'Pantalla completa' },
          ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
          { type: 'separator' },
          { role: 'quit', label: 'Salir' },
        ],
      },
      {
        label: 'Editar',
        submenu: [
          { role: 'copy', label: 'Copiar' },
          { role: 'paste', label: 'Pegar' },
          { role: 'selectAll', label: 'Seleccionar todo' },
        ],
      },
    ]),
  );
  serveApp();
  createWindow();
});

let quitting = false;
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void Promise.allSettled([lan.stop(), stopAdvertising()]).finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
