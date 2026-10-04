import { Readable } from 'node:stream';

export const isS3NotFoundError = (error: unknown): boolean => {
  const candidate = error as {
    readonly name?: string;
    readonly $metadata?: { readonly httpStatusCode?: number };
  };

  return (
    candidate.$metadata?.httpStatusCode === 404 ||
    candidate.name === 'NoSuchKey' ||
    candidate.name === 'NotFound'
  );
};

const streamToBuffer = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
};

export const responseBodyToBuffer = async (body: unknown): Promise<Buffer> => {
  if (!body) {
    return Buffer.alloc(0);
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  const transformable = body as {
    readonly transformToByteArray?: () => Promise<Uint8Array>;
  };
  if (typeof transformable.transformToByteArray === 'function') {
    return Buffer.from(await transformable.transformToByteArray());
  }

  if (body instanceof Readable) {
    return streamToBuffer(body);
  }

  throw new Error('Unsupported S3 response body type.');
};
