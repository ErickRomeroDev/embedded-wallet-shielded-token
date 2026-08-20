// Persists ONLY the passkey credential reference (public data) so the wallet
// can re-derive its seed on later visits. No secret ever touches storage — the
// seed is re-derived from the passkey via PRF each connect.

import type { PasskeyRef } from "./passkey";

const STORAGE_KEY = "embedded-wallet:credential:v1";

export interface CredentialRecord extends PasskeyRef {
  createdAt: number;
}

export function getCredentialRecord(): CredentialRecord | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CredentialRecord) : null;
  } catch {
    return null;
  }
}

export function saveCredentialRecord(ref: PasskeyRef): CredentialRecord {
  const record: CredentialRecord = { ...ref, createdAt: Date.now() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  return record;
}

export function clearCredentialRecord(): void {
  localStorage.removeItem(STORAGE_KEY);
}
