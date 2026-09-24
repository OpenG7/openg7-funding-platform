import { createConnection, createServer } from 'node:net';

// Test-only TCP gate in front of Mailpit. Failures happen before SMTP's greeting,
// so rejected/held connections cannot have delivered a message. MIME and SMTP
// still pass through the application's real transport and Mailpit unchanged.
export function createSmtpGate({ host = 'mailpit', port = 1025 } = {}) {
  let mode = 'allow';
  const held = new Set();
  const sockets = new Set();
  const counts = { connections: 0, rejected: 0, forwarded: 0 };
  const forward = (socket) => {
    held.delete(socket);
    if (socket.destroyed) return;
    counts.forwarded++;
    const upstream = createConnection({ host, port });
    sockets.add(upstream);
    upstream.on('error', () => socket.destroy());
    upstream.on('close', () => {
      sockets.delete(upstream);
      socket.destroy();
    });
    socket.on('close', () => upstream.destroy());
    socket.pipe(upstream).pipe(socket);
  };
  const reject = (socket) => {
    held.delete(socket);
    counts.rejected++;
    socket.end('421 4.3.0 Simulated temporary SMTP outage\r\n');
  };
  const server = createServer((socket) => {
    counts.connections++;
    sockets.add(socket);
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      held.delete(socket);
      sockets.delete(socket);
    });
    socket.setTimeout(30000, () => socket.destroy());
    if (mode === 'hold') held.add(socket);
    else if (mode === 'reject') reject(socket);
    else forward(socket);
  });
  return {
    server,
    snapshot: () => ({ mode, held: held.size, ...counts }),
    setMode(value) {
      if (!['allow', 'hold', 'reject'].includes(value))
        throw new Error('Invalid SMTP gate mode');
      mode = value;
      if (mode !== 'hold')
        for (const socket of [...held])
          if (mode === 'allow') forward(socket);
          else reject(socket);
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}
