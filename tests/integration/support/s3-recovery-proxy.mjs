import { createServer, request } from 'node:http';
import { once } from 'node:events';

// S3Mock lacks ACL/policy inspection. Only these control-plane replies are simulated;
// all object operations use the disposable provider. Hooks inject failures in tests.
export async function createS3RecoveryProxy(
  endpoint,
  { unsafePolicy = () => false, onRequest = () => false } = {}
) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, endpoint);
    if (onRequest(req, res, url)) return;
    if (url.searchParams.has('acl') && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/xml');
      res.end(
        '<AccessControlPolicy xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Owner><ID>fixture</ID></Owner><AccessControlList><Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>fixture</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>'
      );
      return;
    }
    if (url.searchParams.has('policy') && req.method === 'GET') {
      if (unsafePolicy())
        res
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end('{"Statement":[{"Effect":"Allow","Principal":"*"}]}');
      else
        res
          .writeHead(404, { 'Content-Type': 'application/xml' })
          .end('<Error><Code>NoSuchBucketPolicy</Code></Error>');
      return;
    }
    const upstream = request(
      url,
      { method: req.method, headers: req.headers },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      }
    );
    upstream.on('error', () => res.writeHead(502).end());
    req.pipe(upstream);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server;
}
