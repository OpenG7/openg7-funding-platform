export interface AdminDocumentDeliveryBrowser {
  readonly crypto: Pick<Crypto, 'subtle' | 'randomUUID'>;
  storage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  saveBlob(blob: Blob, filename: string): void;
}

/** Resolve browser resources only when an action runs, including during SSR. */
export function adminDocumentDeliveryBrowser(): AdminDocumentDeliveryBrowser | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }
  return {
    crypto: window.crypto,
    storage: () => {
      try {
        return window.sessionStorage;
      } catch {
        return null;
      }
    },
    saveBlob: (blob, filename) => {
      const url = window.URL.createObjectURL(blob);
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
      } finally {
        window.URL.revokeObjectURL(url);
      }
    }
  };
}
