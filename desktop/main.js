/* Delimiter Lab - desktop. Starts Electron, serves the page from app://delimiter-lab/, and opens
 * web links in the browser of the system. The page is the one on the web, unchanged.
 *
 * The page comes from dist/web, which scripts/stage-web.mjs makes. A packaged application
 * carries that tree in its resources. Started with --smoke, the application checks that the
 * page and its worker run, then stops with 0, or with 1 after an error or 30 seconds.
 */
'use strict';
const { app, BrowserWindow, Menu, net, protocol, shell } = require('electron');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_ID = 'io.github.ethanpil.delimiter-lab'; // the same as appId in electron-builder.yml
const HOST = 'delimiter-lab';
const ORIGIN = 'app://' + HOST;
const ROOT = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '../dist/web');
const SMOKE = process.argv.includes('--smoke');

// Chromium takes the type of a file from the system, and on Windows a .js file can be text/plain.
// The types are given here, so every machine serves the same page.
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.json': 'application/json'
};

// The page needs one origin with a host name. standard: relative paths resolve, and the browser
// storage works. secure: navigator.deviceMemory exists, which sets the memory budget. The host is
// not localhost, so DL.BUILD is the version and not a new number at each start.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

// Serves one file of the page. The query string (?v=1.0, ?debug) is not part of the path.
async function serve(request) {
  try {
    const url = new URL(request.url);
    if (url.host !== HOST) return new Response('', { status: 404 });
    const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    const rel = path.relative(ROOT, file);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return new Response('', { status: 403 });
    const res = await net.fetch(pathToFileURL(file).toString());
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    return new Response(res.body, { status: res.status, headers: { 'Content-Type': type } });
  } catch (e) {
    return new Response('', { status: 404 });
  }
}

function menu() {
  const mac = process.platform === 'darwin';
  const view = [{ role: 'reload' }, { role: 'forceReload' }];
  if (!app.isPackaged) view.push({ role: 'toggleDevTools' });
  view.push({ type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
    { type: 'separator' }, { role: 'togglefullscreen' });
  return Menu.buildFromTemplate([
    ...(mac ? [{ role: 'appMenu' }] : []),
    // The page handles Ctrl+Z and Ctrl+Y itself outside the inputs. A key that the page takes
    // never reaches the menu, so these entries work in the inputs only, which is their purpose.
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'View', submenu: view },
    { role: 'windowMenu' }
  ]);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 720, minHeight: 480,
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  // A web link opens in the browser of the system. The window itself never leaves the page: a
  // dropped file that the page does not take would open as a file:// page without this.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith(ORIGIN + '/')) return;
    e.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
  return win;
}

// Opens the page with ?debug, which puts the parts of the page on window.DLApp, and asks the
// worker of the page for its memory. An answer proves that the worker started over app://.
function smoke(win) {
  const expected = readFileSync(path.join(ROOT, 'js/manifest.js'), 'utf8').match(/DL\.VERSION = '([^']+)'/)[1];
  const fail = (why) => { console.error('smoke: ' + why); app.exit(1); };
  const timer = setTimeout(() => fail('no answer after 30 s'), 30000);
  win.webContents.on('console-message', (d) => { if (d.level === 'error') console.error('page: ' + d.message); });
  win.webContents.on('did-fail-load', (e, code, why, url, main) => { if (main) fail('the page did not load: ' + why); });
  win.webContents.once('did-finish-load', async () => {
    try {
      const got = await win.webContents.executeJavaScript(`(async function () {
        if (DL.VERSION !== ${JSON.stringify(expected)}) throw new Error('DL.VERSION is ' + DL.VERSION);
        var m = await DLApp.engine.memory();
        if (m.type !== 'memory') throw new Error('the worker answered ' + m.type);
        return DL.VERSION;
      })()`);
      // electron-builder needs three numbers, so build.mjs makes 1.0 into 1.0.0.
      const three = expected.split('.').length === 2 ? expected + '.0' : expected;
      if (app.isPackaged && app.getVersion() !== three) throw new Error('the application says ' + app.getVersion() + ', the page says ' + expected);
      clearTimeout(timer);
      console.log('smoke: ok, version ' + got);
      app.exit(0);
    } catch (e) { fail(e.message || String(e)); }
  });
}

app.setAppUserModelId(APP_ID); // Windows groups the window with the shortcut of the installer by this name
app.whenReady().then(() => {
  protocol.handle('app', serve);
  Menu.setApplicationMenu(menu());
  const win = createWindow();
  if (SMOKE) smoke(win);
  win.loadURL(ORIGIN + (SMOKE ? '/?debug' : '/'));
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow().loadURL(ORIGIN + '/'); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
