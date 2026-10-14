import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Local S3 protocol fixture with real private files and immutable conditional writes.
 * Only the bucket's capabilities are synthetic; production BackupStorage still
 * signs requests, uploads, checks the version and hashes the downloaded bytes.
 */
export async function startBackupObjectStore(directory) {
  await mkdir(directory, { mode: 0o700 });
  let uploads = 0;
  const owner = 'a'.repeat(64);
  const xml = (response, body, status = 200, headers = {}) => {
    response.writeHead(status, {
      'Content-Type': 'application/xml',
      ...headers
    });
    response.end(body);
  };
  const failure = (res, code, status) =>
    xml(res, `<Error><Code>${code}</Code></Error>`, status);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (
        req.method === 'GET' &&
        ['/backup-journey', '/backup-journey/'].includes(url.pathname)
      ) {
        if (url.searchParams.has('object-lock'))
          return xml(
            res,
            '<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled></ObjectLockConfiguration>'
          );
        if (url.searchParams.has('versioning'))
          return xml(
            res,
            '<VersioningConfiguration><Status>Enabled</Status></VersioningConfiguration>'
          );
        if (url.searchParams.has('acl'))
          return xml(
            res,
            `<AccessControlPolicy><Owner><ID>${owner}</ID></Owner><AccessControlList><Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>${owner}</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>`
          );
        if (url.searchParams.has('policy'))
          return failure(res, 'NoSuchBucketPolicy', 404);
      }
      const match =
        /^\/backup-journey\/synthetic\/database\/([a-f0-9-]{36})\.sql\.age$/.exec(
          url.pathname
        );
      if (!match) return failure(res, 'InvalidRequest', 400);
      const id = match[1];
      const file = join(directory, id + '.sql.age');
      const proofFile = join(directory, id + '.json');
      if (req.method === 'PUT') {
        if (
          req.headers['if-none-match'] !== '*' ||
          req.headers['x-amz-object-lock-mode'] !== 'COMPLIANCE'
        )
          return failure(res, 'InvalidRequest', 400);
        const retainUntil = req.headers['x-amz-object-lock-retain-until-date'];
        if (
          !Number.isFinite(Date.parse(retainUntil)) ||
          Date.parse(retainUntil) <= Date.now()
        )
          return failure(res, 'InvalidRequest', 400);
        const chunks = [];
        let length = 0;
        for await (const bytes of req) {
          length += bytes.length;
          if (length > 20 * 1024 * 1024)
            return failure(res, 'EntityTooLarge', 413);
          chunks.push(bytes);
        }
        const body = Buffer.concat(chunks);
        const sha256 = createHash('sha256').update(body).digest('hex');
        if (
          Buffer.from(sha256, 'hex').toString('base64') !==
          req.headers['x-amz-checksum-sha256']
        )
          return failure(res, 'BadDigest', 400);
        try {
          await writeFile(file, body, { flag: 'wx', mode: 0o600 });
        } catch (error) {
          if (error.code === 'EEXIST')
            return failure(res, 'PreconditionFailed', 412);
          throw error;
        }
        const proof = {
          version: randomUUID(),
          retainUntil,
          sha256,
          bytes: body.length,
          requestId: req.headers['x-amz-meta-request-id'],
          metadataSha256: req.headers['x-amz-meta-sha256']
        };
        await writeFile(proofFile, JSON.stringify(proof), {
          flag: 'wx',
          mode: 0o600
        });
        uploads++;
        return xml(res, '<PutObjectResult/>', 200, {
          'x-amz-version-id': proof.version
        });
      }
      if (req.method === 'HEAD' || req.method === 'GET') {
        const proof = JSON.parse(await readFile(proofFile, 'utf8'));
        const body = await readFile(file);
        if (
          url.searchParams.has('versionId') &&
          url.searchParams.get('versionId') !== proof.version
        )
          return failure(res, 'NoSuchVersion', 404);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': body.length,
          'x-amz-version-id': proof.version,
          'x-amz-meta-sha256': proof.metadataSha256,
          'x-amz-meta-request-id': proof.requestId,
          'x-amz-object-lock-mode': 'COMPLIANCE',
          'x-amz-object-lock-retain-until-date': proof.retainUntil
        });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }
      // No mutation API can overwrite or remove a retained object.
      return failure(res, 'AccessDenied', 403);
    } catch (error) {
      failure(
        res,
        error.code === 'ENOENT' ? 'NoSuchKey' : 'InternalError',
        error.code === 'ENOENT' ? 404 : 500
      );
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    uploads: () => uploads,
    file: (id) => {
      if (!/^[a-f0-9-]{36}$/.test(id))
        throw new Error('Invalid fixture object');
      return join(directory, id + '.sql.age');
    },
    async stop() {
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    }
  };
}
