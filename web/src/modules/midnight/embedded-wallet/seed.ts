// Derives the HD wallet seed from the passkey PRF output.
//
// The PRF output is used only as HKDF input keying material, domain-separated
// by an info string, so the wallet seed is distinct from the raw PRF value and
// from any other future use of the same passkey.

const HKDF_INFO = "modular-starter:wallet-seed:v0";

// Copy into a fresh ArrayBuffer-backed view so the value is a plain BufferSource
// (WebCrypto's DOM types reject the SharedArrayBuffer-capable Uint8Array).
function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(u.byteLength);
  new Uint8Array(buf).set(u);
  return buf;
}

/** HKDF-SHA256 expand the 32-byte PRF secret into a 32-byte seed, hex-encoded. */
export async function prfToSeedHex(prf: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(prf), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new ArrayBuffer(32),
      info: toArrayBuffer(new TextEncoder().encode(HKDF_INFO)),
    },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, "0")).join("");
}
