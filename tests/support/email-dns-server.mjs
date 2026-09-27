import dgram from 'node:dgram';
import net from 'node:net';
import { once } from 'node:events';
import { randomInt } from 'node:crypto';

const randomPort = () => randomInt(49152, 65536);

const wireName = (name) =>
  Buffer.concat([
    ...name
      .split('.')
      .map((part) =>
        Buffer.concat([Buffer.from([part.length]), Buffer.from(part)])
      ),
    Buffer.from([0])
  ]);
function record(name, type, data) {
  const header = Buffer.alloc(10);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(1, 2);
  header.writeUInt32BE(60, 4);
  header.writeUInt16BE(data.length, 8);
  return Buffer.concat([wireName(name), header, data]);
}
function txt(name, parts) {
  return record(
    name,
    16,
    Buffer.concat(
      parts.map((part) => {
        const data = Buffer.from(part);
        if (data.length > 255)
          throw new Error('Fixture TXT character-string too long.');
        return Buffer.concat([Buffer.from([data.length]), data]);
      })
    )
  );
}

// An isolated DNS peer, never a forwarding resolver. Unknown names return NXDOMAIN.
export async function startEmailDnsServer(
  t,
  entries,
  { choosePort = randomPort } = {}
) {
  const requests = [],
    sockets = new Set();
  const reply = (packet, transport) => {
    if (packet.length < 17 || packet.readUInt16BE(4) !== 1)
      throw new Error('Unexpected DNS question.');
    const labels = [];
    let offset = 12;
    while (packet[offset]) {
      const length = packet[offset++];
      if (length > 63 || offset + length >= packet.length)
        throw new Error('Invalid fixture question.');
      labels.push(packet.subarray(offset, offset + length).toString());
      offset += length;
    }
    offset++;
    const name = labels.join('.').toLowerCase(),
      type = packet.readUInt16BE(offset);
    offset += 4;
    requests.push({ name, type, transport });
    const entry = entries[name];
    if (entry?.drop) return null;
    const truncated = entry?.tcp && transport === 'udp';
    const answers = [];
    if (!truncated && entry && !entry.rcode) {
      if (entry.cname) answers.push(record(name, 5, wireName(entry.cname)));
      for (const parts of entry.txt ?? [])
        answers.push(txt(entry.cname ?? name, parts));
    }
    const header = Buffer.alloc(12);
    header.writeUInt16BE(packet.readUInt16BE(0), 0);
    header.writeUInt16BE(
      0x8480 | (truncated ? 0x0200 : 0) | (entry ? (entry.rcode ?? 0) : 3),
      2
    );
    header.writeUInt16BE(1, 4);
    header.writeUInt16BE(answers.length, 6);
    return Buffer.concat([header, packet.subarray(12, offset), ...answers]);
  };
  const handleConnection = (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let buffered = Buffer.alloc(0);
    socket.on('data', (data) => {
      buffered = Buffer.concat([buffered, data]);
      while (
        buffered.length >= 2 &&
        buffered.length >= 2 + buffered.readUInt16BE(0)
      ) {
        const size = buffered.readUInt16BE(0);
        const response = reply(buffered.subarray(2, 2 + size), 'tcp');
        buffered = buffered.subarray(2 + size);
        if (response) {
          const length = Buffer.alloc(2);
          length.writeUInt16BE(response.length);
          socket.write(Buffer.concat([length, response]));
        }
      }
    });
  };
  // A free TCP port can be reserved for UDP on Windows. Probe both protocols
  // and choose another random candidate on conflict, rather than walking a
  // potentially long excluded range one port at a time.
  for (let attempt = 0; attempt < 32; attempt++) {
    const port = choosePort();
    const tcp = net.createServer(handleConnection);
    const udp = dgram.createSocket('udp4');
    const stop = async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => tcp.close(resolve));
      await new Promise((resolve, reject) => {
        try {
          udp.close(resolve);
        } catch (error) {
          if (error.code === 'ERR_SOCKET_DGRAM_NOT_RUNNING') resolve();
          else reject(error);
        }
      });
    };
    udp.on('message', (packet, peer) => {
      const response = reply(packet, 'udp');
      if (response) udp.send(response, peer.port, peer.address);
    });
    try {
      tcp.listen(port, '127.0.0.1');
      await once(tcp, 'listening');
      udp.bind(port, '127.0.0.1');
      await once(udp, 'listening');
    } catch (error) {
      await stop();
      if (!['EADDRINUSE', 'EACCES'].includes(error.code) || attempt === 31)
        throw error;
      continue;
    }
    t.after(stop);
    return { server: '127.0.0.1:' + port, requests };
  }
}
