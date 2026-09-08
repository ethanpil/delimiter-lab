/* Delimiter Lab - desktop. Starts Electron, serves the page at app://delimiter-lab/, and opens
 * web links in the browser of the system. The page is the one on the web, unchanged.
 *
 * The page comes from dist/web, which scripts/stage-web.mjs makes. A packaged application
 * carries that tree in its resources. With --smoke, the application checks that the page and
 * its worker run, then stops with 0. After an error or 30 seconds, it stops with 1.
 */
'use strict';
const { app, BrowserWindow, Menu, net, protocol, shell } = require('electron');
const { existsSync, mkdtempSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP_ID = 'io.github.ethanpil.delimiter-lab'; // the same as appId in electron-builder.yml
const HOST = 'delimiter-lab';
const ORIGIN = 'app://' + HOST;
const ROOT = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '../dist/web');
const SMOKE = process.argv.includes('--smoke');

// The page needs one origin with a host name. standard: relative paths resolve, and the browser
// storage works. secure: navigator.deviceMemory exists, which sets the memory budget. The host is
// not localhost, so DL.BUILD is the version and not a new number at each start.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true } }]);

// Supplies one file of the page. The query string (?v=1.0, ?debug) is not part of the path.
async function serve(request) {
  try {
    const url = new URL(request.url);
    if (url.host !== HOST) return new Response('', { status: 404 });
    const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    const rel = path.relative(ROOT, file);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return new Response('', { status: 403 });
    return await net.fetch(pathToFileURL(file).toString());
  } catch (e) {
    return new Response('', { status: 404 });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 720, minHeight: 480,
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  // A web link opens in the browser of the system. The window itself never leaves the page.
  // Without this, a dropped file that the page does not take opens as a file:// page.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => {
    if (e.url.startsWith(ORIGIN + '/')) return;
    e.preventDefault();
    if (/^https?:/.test(e.url)) shell.openExternal(e.url);
  });
  // A browser gives an input a menu on a right click. Electron gives none, so this one does.
  win.webContents.on('context-menu', (e, p) => {
    if (!p.isEditable && !p.selectionText) return;
    Menu.buildFromTemplate([{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]).popup();
  });
  return win;
}

// Says one line and stops. The write completes before the stop, so a pipe gets the line too.
function stop(code, line) {
  (code ? process.stderr : process.stdout).write(line + '\n', () => app.exit(code));
}

// Opens the page with ?debug, which puts the parts of the page on window.DLApp. Then asks the
// worker of the page for its memory. An answer shows that the worker started over app://.
function smoke(win) {
  const started = Date.now();
  const timer = setTimeout(() => stop(1, 'smoke: no answer after 30 s'), 30000);
  if (!existsSync(path.join(ROOT, 'index.html'))) return stop(1, 'smoke: no page in ' + ROOT + '. Run: npm run stage');
  win.webContents.on('console-message', (d) => { if (d.level === 'error') console.error('page: ' + d.message); });
  win.webContents.once('did-finish-load', async () => {
    try {
      const version = await win.webContents.executeJavaScript(`(async function () {
        var m = await DLApp.engine.memory();
        if (m.type !== 'memory') throw new Error('the worker answered ' + m.type);
        return DL.VERSION;
      })()`);
      // build.mjs gives the application the version of the manifest. The page must carry the same.
      if (app.isPackaged && app.getVersion() !== version) throw new Error('the application says ' + app.getVersion() + ', the page says ' + version);
      clearTimeout(timer);
      // The time says how near the 30 seconds this machine came. Rosetta makes an Intel build slow.
      stop(0, 'smoke: ok, version ' + version + ', ' + ((Date.now() - started) / 1000).toFixed(1) + ' s');
    } catch (e) { stop(1, 'smoke: ' + (e.message || e)); }
  });
}

// One application at a time. A second one on the same workspace keeps its work in memory only
// and loses it at the end. The check runs on a new workspace of its own, so it never meets the
// application of the user, or another check.
if (SMOKE) app.setPath('userData', mkdtempSync(path.join(app.getPath('temp'), 'delimiter-lab-smoke-')));
if (!app.requestSingleInstanceLock()) {
  console.error('Delimiter Lab is open in another window.');
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.setAppUserModelId(APP_ID); // Windows puts the window and the shortcut of the installer in one group by this name
  app.whenReady().then(() => {
    protocol.handle('app', serve);
    const win = createWindow();
    if (SMOKE) smoke(win);
    win.loadURL(ORIGIN + (SMOKE ? '/?debug' : '/'));
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow().loadURL(ORIGIN + '/'); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
