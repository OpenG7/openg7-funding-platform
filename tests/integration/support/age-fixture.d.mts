export const ageBinary: string;
export const ageAvailable: boolean;
export function createAgeFixture(directory: string): {
  identity: string;
  recipient: string;
  ageBinary: string;
  encrypt(bytes: Uint8Array): Buffer;
  decrypt(file: string): Buffer;
};
