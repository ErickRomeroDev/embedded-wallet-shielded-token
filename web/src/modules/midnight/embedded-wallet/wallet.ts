// Browser-side embedded wallet: builds a Midnight WalletFacade from an HD seed
// and exposes the balance/sign/submit pipeline the ConnectedAPI adapter needs.
//
// This mirrors node/src/api.ts (proven against @midnightntwrk/wallet-sdk@1.2.0)
// minus the Node-only pieces: no `ws` import (the browser has native WebSocket),
// InMemoryTransactionHistoryStorage (no LevelDB), no console spinners.
//
// This module is heavy (pulls in the wallet SDK + WASM) and must only ever be
// loaded via dynamic import so it stays out of the initial bundle.

import * as Rx from "rxjs";
import * as ledger from "@midnight-ntwrk/ledger-v8";
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  TransactionHistoryStorage,
  type UnshieldedKeystore,
  UnshieldedWallet,
  PublicKey,
  ShieldedWallet,
  DustWallet,
  WalletFacade,
  HDWallet,
  Roles,
} from "@midnightntwrk/wallet-sdk";
import { networkId } from "@midnight-ntwrk/midnight-js";
import { toHex, fromHex } from "@midnight-ntwrk/compact-runtime";
import type { EmbeddedEndpoints } from "./config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FacadeState = any;

export interface EmbeddedSession {
  wallet: WalletFacade;
  keystore: UnshieldedKeystore;
  latestState: () => FacadeState | undefined;
  waitForSynced: () => Promise<FacadeState>;
  balanceUnsealed: (txHex: string) => Promise<string>;
  submit: (txHex: string) => Promise<void>;
  registerDustIfNeeded: () => Promise<void>;
  stop: () => Promise<void>;
}

const deriveKeysFromSeed = (seedHex: string) => {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seedHex, "hex"));
  if (hdWallet.type !== "seedOk") {
    throw new Error("Failed to initialize HDWallet from seed");
  }
  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  if (derivationResult.type !== "keysDerived") {
    throw new Error("Failed to derive keys");
  }
  hdWallet.hdWallet.clear();
  return derivationResult.keys;
};

const makeTxHistoryStorage = () =>
  new InMemoryTransactionHistoryStorage(TransactionHistoryStorage.TransactionHistoryCommonSchema);

const buildShieldedConfig = (e: EmbeddedEndpoints) => ({
  networkId: networkId.getNetworkId(),
  indexerClientConnection: { indexerHttpUrl: e.indexer, indexerWsUrl: e.indexerWS },
  provingServerUrl: new URL(e.proofServer),
  relayURL: new URL(e.node.replace(/^http/, "ws")),
  txHistoryStorage: makeTxHistoryStorage(),
});

const buildUnshieldedConfig = (e: EmbeddedEndpoints) => ({
  networkId: networkId.getNetworkId(),
  indexerClientConnection: { indexerHttpUrl: e.indexer, indexerWsUrl: e.indexerWS },
  txHistoryStorage: makeTxHistoryStorage(),
});

const buildDustConfig = (e: EmbeddedEndpoints) => ({
  networkId: networkId.getNetworkId(),
  costParameters: { additionalFeeOverhead: 300_000_000_000_000n, feeBlocksMargin: 5 },
  indexerClientConnection: { indexerHttpUrl: e.indexer, indexerWsUrl: e.indexerWS },
  provingServerUrl: new URL(e.proofServer),
  relayURL: new URL(e.node.replace(/^http/, "ws")),
  txHistoryStorage: makeTxHistoryStorage(),
});

/**
 * Sign all unshielded offers in a transaction's intents, using the correct
 * proof marker for Intent.deserialize. Works around a wallet SDK bug where
 * signRecipe hardcodes 'pre-proof', which fails for proven (UnboundTransaction)
 * intents that contain 'proof' data. DApp transactions arrive proven, so this
 * is required. Ported verbatim from node/src/api.ts.
 */
const signTransactionIntents = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: { intents?: Map<number, any> },
  signFn: (payload: Uint8Array) => ledger.Signature,
  proofMarker: "proof" | "pre-proof",
): void => {
  if (!tx.intents || tx.intents.size === 0) return;

  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;

    const cloned = ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>(
      "signature",
      proofMarker,
      "pre-binding",
      intent.serialize(),
    );

    const sigData = cloned.signatureData(segment);
    const signature = signFn(sigData);

    if (cloned.fallibleUnshieldedOffer) {
      const sigs = cloned.fallibleUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.fallibleUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.fallibleUnshieldedOffer = cloned.fallibleUnshieldedOffer.addSignatures(sigs);
    }

    if (cloned.guaranteedUnshieldedOffer) {
      const sigs = cloned.guaranteedUnshieldedOffer.inputs.map(
        (_: ledger.UtxoSpend, i: number) => cloned.guaranteedUnshieldedOffer!.signatures.at(i) ?? signature,
      );
      cloned.guaranteedUnshieldedOffer = cloned.guaranteedUnshieldedOffer.addSignatures(sigs);
    }

    tx.intents.set(segment, cloned);
  }
};

export async function startEmbeddedSession(
  net: string,
  seedHex: string,
  endpoints: EmbeddedEndpoints,
): Promise<EmbeddedSession> {
  networkId.setNetworkId(net as Parameters<typeof networkId.setNetworkId>[0]);

  const keys = deriveKeysFromSeed(seedHex);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const keystore = createKeystore(keys[Roles.NightExternal], networkId.getNetworkId());

  const shieldedWallet = ShieldedWallet(buildShieldedConfig(endpoints)).startWithSecretKeys(shieldedSecretKeys);
  const unshieldedWallet = UnshieldedWallet(buildUnshieldedConfig(endpoints)).startWithPublicKey(
    PublicKey.fromKeyStore(keystore),
  );
  const dustWallet = DustWallet(buildDustConfig(endpoints)).startWithSecretKey(
    dustSecretKey,
    ledger.LedgerParameters.initialParameters().dust,
  );

  const wallet = await WalletFacade.init({
    configuration: {
      ...buildShieldedConfig(endpoints),
      ...buildUnshieldedConfig(endpoints),
      ...buildDustConfig(endpoints),
    },
    shielded: () => shieldedWallet,
    unshielded: () => unshieldedWallet,
    dust: () => dustWallet,
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);

  // Keep the latest facade state in a closure so the ConnectedAPI getters read
  // current balances/addresses without re-subscribing.
  let latest: FacadeState | undefined;
  const sub = wallet.state().subscribe((s: FacadeState) => {
    latest = s;
  });

  const waitForSynced = (): Promise<FacadeState> =>
    Rx.firstValueFrom(wallet.state().pipe(Rx.filter((s: FacadeState) => s.isSynced)));

  const signFn = (payload: Uint8Array) => keystore.signData(payload);

  const balanceUnsealed = async (txHex: string): Promise<string> => {
    const tx = ledger.Transaction.deserialize<ledger.SignatureEnabled, ledger.Proof, ledger.PreBinding>(
      "signature",
      "proof",
      "pre-binding",
      fromHex(txHex),
    );
    await waitForSynced();
    const recipe = await wallet.balanceUnboundTransaction(
      tx,
      { shieldedSecretKeys, dustSecretKey },
      { ttl: new Date(Date.now() + 30 * 60 * 1000) },
    );
    signTransactionIntents(recipe.baseTransaction, signFn, "proof");
    if (recipe.balancingTransaction) {
      signTransactionIntents(recipe.balancingTransaction, signFn, "pre-proof");
    }
    const finalized = await wallet.finalizeRecipe(recipe);
    return toHex(finalized.serialize());
  };

  const submit = async (txHex: string): Promise<void> => {
    const tx = ledger.Transaction.deserialize<ledger.SignatureEnabled, ledger.Proof, ledger.Binding>(
      "signature",
      "proof",
      "binding",
      fromHex(txHex),
    );
    await wallet.submitTransaction(tx);
  };

  const registerDustIfNeeded = async (): Promise<void> => {
    const state = await waitForSynced();

    const nightUtxos = state.unshielded.availableCoins.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (coin: any) => coin.meta?.registeredForDustGeneration !== true,
    );
    // Nothing to register — either no NIGHT, or all NIGHT is already registered.
    if (nightUtxos.length === 0) return;

    // Registration pays its own DUST fee out of the DUST the NIGHT generates.
    // Held NIGHT generates DUST continuously, so wait until the projected
    // generated DUST covers the registration fee before submitting — otherwise
    // the registration reverts with "Insufficient generated dust".
    const { fee } = await wallet.estimateRegistration(nightUtxos);
    await wallet.waitForGeneratedDust(nightUtxos, fee, { timeoutMs: 10 * 60 * 1000 });

    const recipe = await wallet.registerNightUtxosForDustGeneration(
      nightUtxos,
      keystore.getPublicKey(),
      signFn,
    );
    const finalized = await wallet.finalizeRecipe(recipe);
    await wallet.submitTransaction(finalized);

    // Wait for spendable dust to appear.
    await Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.throttleTime(5_000),
        Rx.filter((s: FacadeState) => s.isSynced),
        Rx.filter((s: FacadeState) => s.dust.balance(new Date()) > 0n),
      ),
    );
  };

  const stop = async (): Promise<void> => {
    sub.unsubscribe();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (wallet as any).stop?.();
    } catch {
      /* best effort */
    }
  };

  return {
    wallet,
    keystore,
    latestState: () => latest,
    waitForSynced,
    balanceUnsealed,
    submit,
    registerDustIfNeeded,
    stop,
  };
}
