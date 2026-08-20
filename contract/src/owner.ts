import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash
} from "@midnight-ntwrk/compact-runtime";

// Off-chain mirror of the Ownable module's account-id derivation:
//   accountId = persistentHash<Vector<1, Bytes<32>>>([secretKey])
// (contract/src/modules/utils/Utils.compact, computeAccountId). The
// no-drift contract test asserts this stays in lockstep with the circuit.
export const computeOwnerCommitment = (secretKey: Uint8Array): Uint8Array => {
  if (secretKey.length !== 32) {
    throw new Error(
      `computeOwnerCommitment: expected 32-byte secret key, received ${secretKey.length} bytes`
    );
  }
  return persistentHash(new CompactTypeVector(1, new CompactTypeBytes(32)), [
    secretKey
  ]);
};

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export const fromHex = (hex: string): Uint8Array => {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error(`fromHex: invalid hex string`);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};
