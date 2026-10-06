export function sha256(bytes: string | Uint8Array): string;
export function filesIn(directory: string, base?: string): string[];
export function checkPackage(directory: string): {
  name: string;
  version: string;
  files: number;
  sources: number;
};
