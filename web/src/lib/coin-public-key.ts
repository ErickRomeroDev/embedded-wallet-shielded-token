import { MidnightBech32m, ShieldedCoinPublicKey } from "@midnightntwrk/wallet-sdk";
import { networkId } from "@midnight-ntwrk/midnight-js";

/**
 * The dapp-connector (wallet) exposes the shielded coin public key as a Bech32m
 * string (e.g. `mn_shield-cpk_undeployed1…`), while the contract circuits take
 * the raw 32-byte key. Convert Bech32m → lowercase hex of those raw bytes.
 * Returns "" for empty/malformed input so callers can decide how to fail.
 * Requires the network id to be set (done by walletController on connect).
 */
export function coinPublicKeyToHex(bech32mCoinPublicKey: string): string {
  if (!bech32mCoinPublicKey) return "";
  try {
    const bytes = ShieldedCoinPublicKey.codec.decode(
      networkId.getNetworkId(),
      MidnightBech32m.parse(bech32mCoinPublicKey),
    ).data;
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch (e) {
    console.warn("[coin-public-key] failed to decode Bech32m coin public key", e);
    return "";
  }
}
