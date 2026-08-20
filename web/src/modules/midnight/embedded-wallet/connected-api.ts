// Adapts the embedded WalletFacade session to the dapp-connector ConnectedAPI
// the app already consumes. Only 10 methods are ever called by the app; the
// remaining ConnectedAPI surface is stubbed so the object still typechecks.
//
// The returned object must have STABLE reference identity per connection —
// use-contract-subscription re-joins the contract whenever `connectedAPI`
// changes by reference.

import { MidnightBech32m, ShieldedCoinPublicKey, ShieldedEncryptionPublicKey } from "@midnightntwrk/wallet-sdk";
import { networkId } from "@midnight-ntwrk/midnight-js";
import type { EmbeddedEndpoints } from "./config";
import type { EmbeddedSession } from "./wallet";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyState = any;

const notSupported = (method: string) => (): Promise<never> =>
  Promise.reject(new Error(`embedded wallet: ${method} is not supported`));

export function makeConnectedAPI(session: EmbeddedSession, endpoints: EmbeddedEndpoints, net: string) {
  const requireState = (): AnyState => {
    const s = session.latestState();
    if (!s) throw new Error("Embedded wallet is not ready yet — wait for sync.");
    return s;
  };

  const nid = () => networkId.getNetworkId();

  const api = {
    getConfiguration: async () => ({
      indexerUri: endpoints.indexer,
      indexerWsUri: endpoints.indexerWS,
      proverServerUri: endpoints.proofServer,
      substrateNodeUri: endpoints.node,
      networkId: net,
    }),
    getConnectionStatus: async () => ({ status: "connected" as const, networkId: net }),

    getShieldedAddresses: async () => {
      const s = requireState();
      const coinPub = ShieldedCoinPublicKey.fromHexString(s.shielded.coinPublicKey.toHexString());
      const encPub = ShieldedEncryptionPublicKey.fromHexString(s.shielded.encryptionPublicKey.toHexString());
      return {
        shieldedAddress: MidnightBech32m.encode(nid(), s.shielded.address).toString(),
        shieldedCoinPublicKey: ShieldedCoinPublicKey.codec.encode(nid(), coinPub).toString(),
        shieldedEncryptionPublicKey: ShieldedEncryptionPublicKey.codec.encode(nid(), encPub).toString(),
      };
    },
    getUnshieldedAddress: async () => ({
      unshieldedAddress: session.keystore.getBech32Address().toString(),
    }),
    getDustAddress: async () => {
      const s = requireState();
      return { dustAddress: MidnightBech32m.encode(nid(), s.dust.address).toString() };
    },

    getShieldedBalances: async () => requireState().shielded.balances as Record<string, bigint>,
    getUnshieldedBalances: async () => requireState().unshielded.balances as Record<string, bigint>,
    getDustBalance: async () => {
      const s = requireState();
      const cap = (s.dust.availableCoins as { maxCap: bigint }[]).reduce(
        (acc, c) => acc + c.maxCap,
        0n,
      );
      return { balance: s.dust.balance(new Date()) as bigint, cap };
    },

    balanceUnsealedTransaction: async (txHex: string) => ({
      tx: await session.balanceUnsealed(txHex),
    }),
    submitTransaction: async (txHex: string) => {
      await session.submit(txHex);
    },

    // Never called by the app — stubbed to satisfy the ConnectedAPI type.
    getTxHistory: async () => [],
    balanceSealedTransaction: notSupported("balanceSealedTransaction"),
    makeTransfer: notSupported("makeTransfer"),
    makeIntent: notSupported("makeIntent"),
    signData: notSupported("signData"),
    getProvingProvider: notSupported("getProvingProvider"),
    hintUsage: async () => {},
  };

  return api;
}

export type EmbeddedConnectedAPI = ReturnType<typeof makeConnectedAPI>;
