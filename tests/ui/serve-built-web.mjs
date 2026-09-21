// Local, read-only static server for the isolated UI suites.
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
  '.webp': 'image/webp',
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
    let status = 200;
    if (info?.isDirectory()) file = resolve(file, 'index.html');
    else if (!info?.isFile()) {
      const clientRoute =
        /^\/(?:admin\/(?:login|auth\/callback|fundraiser(?:\/(?:attention|assistant|contributions|sponsors|invoices|publications(?:\/(?:drafts|batches|calendar|automation))?|expenses|transparency|audit|email-queue|setup|access))?)|dev\/(?:stripe-setup|webhooks|api-keys)|(?:en\/)?fonds-des-batisseurs\/suivi-commandite)\/?$/.test(
          pathname
        );
      status = clientRoute ? 200 : 404;
      file = resolve(
        root,
        clientRoute
          ? 'index.csr.html'
          : pathname.startsWith('/en/')
            ? 'en/404/index.html'
            : '404/index.html'
      );
    }
    if (/^\/(?:en\/)?404(?:\/|$)/.test(pathname)) status = 404;
    response.writeHead(status, {
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
