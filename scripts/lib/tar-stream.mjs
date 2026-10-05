import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

/** Fixed ustar entries, streamed to gzip. No intermediate object/archive files. */
export async function withTarStream(output, populate) {
  const gzip = createGzip({ level: 9 });
  const transfer = pipeline(gzip, output);
  transfer.catch(() => {}); // Awaited below, including population failure.
  const write = async (bytes) => {
    if (!gzip.write(bytes)) await once(gzip, 'drain');
  };
  const writeEntry = async (name, body, expectedBytes) => {
    if (
      !/^(manifest\.json|objects\/[0-9]+\.bin)$/.test(name) ||
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes < 0 ||
      expectedBytes > 0o77777777777
    )
      throw new Error('Invalid streaming backup entry.');
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write('0000600\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(expectedBytes.toString(8).padStart(11, '0') + '\0', 124);
    header.write('00000000000\0', 136);
    header.fill(32, 148, 156);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    header.write(
      [...header]
        .reduce((sum, byte) => sum + byte, 0)
        .toString(8)
        .padStart(6, '0') + '\0 ',
      148
    );
    await write(header);
    let received = 0;
    for await (const chunk of body) {
      received += chunk.length;
      if (received > expectedBytes)
        throw new Error('Streaming backup size changed.');
      await write(chunk);
    }
    if (received !== expectedBytes)
      throw new Error('Streaming backup size changed.');
    await write(Buffer.alloc((512 - (received % 512)) % 512));
  };
  try {
    await populate(writeEntry);
    gzip.end(Buffer.alloc(1024));
    await transfer;
  } catch {
    gzip.destroy(new Error('Streaming backup failed.'));
    await Promise.allSettled([transfer]);
    throw new Error('Streaming backup failed.');
  }
}
