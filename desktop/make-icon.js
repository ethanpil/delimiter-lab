/* Makes icon.png, 1024 x 1024, from img/logo.svg. Run: npm run icon
 * electron-builder makes the .icns and the .ico from it. Electron makes the image from the SVG
 * itself, so no other package is necessary. Run it again when the logo changes. Then commit the file.
 */
'use strict';
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const SIZE = 1024;
// The image must have SIZE pixels, not SIZE times the scale of the screen.
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.whenReady().then(async () => {
  const svg = readFileSync(path.join(__dirname, '../img/logo.svg'), 'utf8');
  const html = '<body style="margin:0;background:transparent"><img width="' + SIZE + '" height="' + SIZE +
    '" src="data:image/svg+xml,' + encodeURIComponent(svg) + '"></body>';
  const win = new BrowserWindow({ show: false, width: SIZE, height: SIZE, transparent: true, webPreferences: { offscreen: true } });
  win.setContentSize(SIZE, SIZE); // a new window is not taller than the screen; this makes it so
  await win.loadURL('data:text/html,' + encodeURIComponent(html));
  const image = await win.webContents.capturePage();
  const size = image.getSize();
  if (size.width !== SIZE || size.height !== SIZE) {
    console.error('The image is ' + size.width + 'x' + size.height + ', not ' + SIZE + 'x' + SIZE + '.');
    app.exit(1);
    return;
  }
  writeFileSync(path.join(__dirname, 'icon.png'), image.toPNG());
  console.log('icon.png ' + size.width + 'x' + size.height);
  app.exit(0);
});
