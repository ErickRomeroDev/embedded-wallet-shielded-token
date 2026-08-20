export const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
};

export const toHexPadded = (str: string, len = 64) =>
  Buffer.from(str, "ascii").toString("hex").padStart(len, "0");

// Builder for the ZswapCoinPublicKey encoding ({ bytes: Bytes<32> }).
import type { CoinKey } from "../simulators/simulator.js";

export const coinKey = (bytes: Uint8Array): CoinKey => ({ bytes });

export const zeroKey = (): CoinKey => coinKey(new Uint8Array(32));
