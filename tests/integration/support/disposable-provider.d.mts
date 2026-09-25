export function startDisposableProvider(kind: 'mail' | 's3'): Promise<{
  ports: Record<number, number>;
  stop(): Promise<string>;
}>;
