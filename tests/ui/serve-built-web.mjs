// Local, read-only static server for the isolated admin UI suite.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const root = resolve('dist/apps/funding-web/browser');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, 'http://127.0.0.1').pathname
    );
    if (pathname.startsWith('/api/')) {
      response.writeHead(503).end('The UI suite must intercept API requests.');
      return;
    }
    let file = resolve(root, '.' + pathname);
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    const info = await stat(file).catch(() => null);
    if (info?.isDirectory()) file = resolve(file, 'index.html');
    else if (!info?.isFile()) file = resolve(root, 'index.csr.html');
    response.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    createReadStream(file)
      .on('error', () => response.destroy())
      .pipe(response);
  } catch {
    response.writeHead(400).end();
  }
}).listen(4179, '127.0.0.1');
