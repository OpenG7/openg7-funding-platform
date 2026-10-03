import { firstHeaderValue } from './http-routing.js';

export interface MultipartPart {
  readonly name: string;
  readonly filename: string | null;
  readonly contentType: string | null;
  readonly data: Buffer;
}

export const parseMultipartBoundary = (
  contentType: string | string[] | undefined
): string | null => {
  const header = firstHeaderValue(contentType);
  if (!header?.toLowerCase().startsWith('multipart/form-data')) {
    return null;
  }

  const match = /(?:^|;\s*)boundary=(?:"([^"]*)"|([^;]+))/i.exec(header);
  const boundary = match?.[1] ?? match?.[2] ?? '';
  return boundary.length > 0 && boundary.length <= 200 ? boundary : null;
};

const splitBuffer = (buffer: Buffer, delimiter: Buffer): Buffer[] => {
  const parts: Buffer[] = [];
  let start = 0;
  let index = buffer.indexOf(delimiter, start);

  while (index !== -1) {
    parts.push(buffer.subarray(start, index));
    start = index + delimiter.byteLength;
    index = buffer.indexOf(delimiter, start);
  }

  parts.push(buffer.subarray(start));
  return parts;
};

const trimMultipartPart = (part: Buffer): Buffer => {
  let start = 0;
  let end = part.byteLength;

  if (part.subarray(0, 2).equals(Buffer.from('\r\n'))) {
    start = 2;
  }

  if (part.subarray(end - 2, end).equals(Buffer.from('\r\n'))) {
    end -= 2;
  }

  return part.subarray(start, end);
};

const parseMultipartPartHeaders = (
  headerText: string
): Record<string, string> =>
  Object.fromEntries(
    headerText
      .split('\r\n')
      .map((line) => {
        const separatorIndex = line.indexOf(':');
        if (separatorIndex === -1) {
          return null;
        }

        return [
          line.slice(0, separatorIndex).trim().toLowerCase(),
          line.slice(separatorIndex + 1).trim()
        ] as const;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry))
  );

const parseContentDispositionValue = (
  value: string,
  key: 'name' | 'filename'
): string | null => {
  const match = new RegExp(`(?:^|;\\s*)${key}="([^"]*)"`).exec(value);
  return match?.[1] ?? null;
};

export const parseMultipartFormData = (
  body: Buffer,
  boundary: string
): readonly MultipartPart[] => {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const rawParts = splitBuffer(body, boundaryBuffer).slice(1);
  const parts: MultipartPart[] = [];

  for (const rawPart of rawParts) {
    if (
      rawPart.subarray(0, 2).equals(Buffer.from('--')) ||
      rawPart.subarray(0, 4).equals(Buffer.from('--\r\n'))
    ) {
      continue;
    }

    const part = trimMultipartPart(rawPart);
    const headerEndIndex = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEndIndex === -1) {
      continue;
    }

    const headers = parseMultipartPartHeaders(
      part.subarray(0, headerEndIndex).toString('utf8')
    );
    const disposition = headers['content-disposition'] ?? '';
    const name = parseContentDispositionValue(disposition, 'name');
    if (!name) {
      continue;
    }

    parts.push({
      name,
      filename: parseContentDispositionValue(disposition, 'filename'),
      contentType: headers['content-type']?.toLowerCase() ?? null,
      data: part.subarray(headerEndIndex + 4)
    });
  }

  return parts;
};
