// Derives secrets from the passkey PRF output.
//
// The PRF output is used only as HKDF input keying material, domain-separated
// by an info string per use: the wallet seed and the Ownable owner secret are
// distinct derivations of the same passkey and never coincide with each other
// or with the raw PRF value.

const WALLET_SEED_INFO = "mintkey:wallet-seed:v0";
const OWNER_SK_INFO = "mintkey:owner-sk:v0";

// Copy into a fresh ArrayBuffer-backed view so the value is a plain BufferSource
// (WebCrypto's DOM types reject the SharedArrayBuffer-capable Uint8Array).
function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(u.byteLength);
  new Uint8Array(buf).set(u);
  return buf;
}

async function hkdf32(prf: Uint8Array, info: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(prf), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new ArrayBuffer(32),
      info: toArrayBuffer(new TextEncoder().encode(info)),
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** HKDF-SHA256 expand the 32-byte PRF secret into a 32-byte wallet seed, hex-encoded. */
export async function prfToSeedHex(prf: Uint8Array): Promise<string> {
  const seed = await hkdf32(prf, WALLET_SEED_INFO);
  return Array.from(seed, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * HKDF-SHA256 expand the PRF secret into the 32-byte Ownable owner secret.
 * Its persistentHash is the on-chain owner commitment; the secret itself
 * stays in memory and never leaves the browser.
 */
export async function prfToOwnerSecret(prf: Uint8Array): Promise<Uint8Array> {
  return hkdf32(prf, OWNER_SK_INFO);
}
