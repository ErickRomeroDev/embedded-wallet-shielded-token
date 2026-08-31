import { type Logger } from 'pino';
import * as Rx from 'rxjs';
import { WebSocket } from 'ws';
import * as bip39 from '@scure/bip39';
import { wordlist as english } from '@scure/bip39/wordlists/english.js';
import {
  ModularCircuits,
  ModularPrivateStateId,
  type ModularProviders,
  type DeployedModularContract,
  type CoinKey,
  type EncodedCoinInfo,
  type MaybeCoinInfo,
  type TokenCoinRecord,
  type TokenState,
} from './common-types';
import { type Config, contractConfig } from './config';
import {
  Modular,
  type ModularPrivateState,
  makeDeployArgs,
  TOKEN_DOMAIN,
  witnesses,
  emptyPrivateState,
} from '@eddalabs/contract';
import * as ledger from '@midnight-ntwrk/ledger-v8';
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
  generateRandomSeed,
  HDWallet,
  Roles,
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from '@midnightntwrk/wallet-sdk';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { type ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { contracts, utils, networkId, types } from '@midnight-ntwrk/midnight-js';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';

let logger: Logger;

// @ts-expect-error: It's needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

export function setLogger(_logger: Logger) {
  logger = _logger;
}

// Pre-compile the MintKey contract with real witnesses (wit_OwnableSK reads
// the owner secret from private state) and ZK circuit assets.
const modularCompiledContract = CompiledContract.make('modular', Modular.Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath),
);

// Types for the new wallet
export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

/**
 * Convert mnemonic phrase to seed buffer using BIP39 standard
 * This generates a 64-byte seed as expected by Midnight HD wallet
 */
export const mnemonicToSeed = async (mnemonic: string): Promise<string> => {
  const words = mnemonic.trim().split(/\s+/);
  if (!bip39.validateMnemonic(words.join(' '), english)) {
    throw new Error('Invalid mnemonic phrase');
  }
  // Use BIP39 standard seed derivation (PBKDF2) - produces 64 bytes. hashes it (mixes it up) 2048 times using SHA-512
  const seed = await bip39.mnemonicToSeed(words.join(' '));
  return Buffer.from(seed).subarray(0, 32).toString('hex');
};

/**
 * The owner commitment currently stored on the contract's public ledger
 * (persistentHash of the owner's secret key). The secret itself never
 * appears on-chain.
 */
export const getOwnerCommitmentFromLedger = async (
  providers: ModularProviders,
  contractAddress: ContractAddress,
): Promise<string | null> => {
  utils.assertIsContractAddress(contractAddress);
  const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
  if (contractState == null) return null;
  const owner = Modular.ledger(contractState.data).Ownable__owner;
  return owner.is_left ? Buffer.from(owner.left).toString('hex') : null;
};

export const joinContract = async (
  providers: ModularProviders,
  contractAddress: string,
  privateState: ModularPrivateState = emptyPrivateState(),
): Promise<DeployedModularContract> => {
  const modularContract = await contracts.findDeployedContract(providers, {
    contractAddress,
    compiledContract: modularCompiledContract,
    privateStateId: ModularPrivateStateId,
    initialPrivateState: privateState,
  });
  logger.info(`Joined contract at address: ${modularContract.deployTxData.public.contractAddress}`);
  return modularContract as DeployedModularContract;
};

export const deploy = async (
  providers: ModularProviders,
  privateState: ModularPrivateState,
  ownerCommitment: Uint8Array,
): Promise<DeployedModularContract> => {
  logger.info('Deploying MintKey contract...');
  const modularContract = await withDustRetry('deploy', () =>
    contracts.deployContract(providers, {
      compiledContract: modularCompiledContract,
      privateStateId: ModularPrivateStateId,
      initialPrivateState: privateState,
      args: [...makeDeployArgs(ownerCommitment)],
    }),
  );
  logger.info(`Deployed contract at address: ${modularContract.deployTxData.public.contractAddress}`);
  return modularContract as unknown as DeployedModularContract;
};

///////////////////////////////////////////////////////////////////////////////
// SHIELDED TOKEN (MKT)
///////////////////////////////////////////////////////////////////////////////

/** Reads the token metadata from the contract's public ledger state. */
export const getTokenState = async (
  providers: ModularProviders,
  contractAddress: ContractAddress,
): Promise<TokenState | null> => {
  utils.assertIsContractAddress(contractAddress);
  const contractState = await providers.publicDataProvider.queryContractState(contractAddress);
  if (contractState == null) return null;
  const state = Modular.ledger(contractState.data);
  return {
    name: state.ShieldedToken__name,
    symbol: state.ShieldedToken__symbol,
    decimals: state.ShieldedToken__decimals,
    domain: state.ShieldedToken__domain,
  };
};

/**
 * The token's color, derived off-chain: tokenType(domain, contractAddress).
 * Execution-verified against the tokenColor circuit in the contract test suite.
 */
export const getTokenColor = (contractAddress: ContractAddress): string =>
  ledger.rawTokenType(TOKEN_DOMAIN, contractAddress);

export const coinToRecord = (coin: EncodedCoinInfo): TokenCoinRecord => ({
  nonceHex: Buffer.from(coin.nonce).toString('hex'),
  colorHex: Buffer.from(coin.color).toString('hex'),
  value: coin.value.toString(),
});

const coinKey = (coinPublicKeyHex: string): CoinKey => ({
  bytes: Buffer.from(coinPublicKeyHex, 'hex'),
});

/**
 * Mints `amount` MKT to `recipientCoinPublicKeyHex` with a fresh random nonce.
 * Owner-gated: the providers' private state must hold the owner secret.
 * The returned coin info is the recipient's only copy — deliver it out of band.
 */
export const mint = async (
  modularContract: DeployedModularContract,
  recipientCoinPublicKeyHex: string,
  amount: bigint,
): Promise<{ tx: types.FinalizedTxData; coin: EncodedCoinInfo }> => {
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(32));
  logger.info(`Minting ${amount} tokens...`);
  const finalizedTxData = await modularContract.callTx.mint(
    coinKey(recipientCoinPublicKeyHex),
    amount,
    nonce,
  );
  logger.info(`Mint tx ${finalizedTxData.public.txHash} in block ${finalizedTxData.public.blockHeight}`);
  return { tx: finalizedTxData.public, coin: finalizedTxData.private.result };
};

/**
 * Burns `amount` MKT (owner-gated). The coin is paid into the transaction by the caller's
 * wallet during balancing; change (if any) is routed back to `refundToCoinPublicKeyHex`.
 */
export const burn = async (
  modularContract: DeployedModularContract,
  contractAddress: ContractAddress,
  amount: bigint,
  refundToCoinPublicKeyHex: string,
  coinOverride?: EncodedCoinInfo,
): Promise<{ tx: types.FinalizedTxData; change: MaybeCoinInfo }> => {
  const coin: EncodedCoinInfo = coinOverride ?? {
    nonce: globalThis.crypto.getRandomValues(new Uint8Array(32)),
    color: Buffer.from(getTokenColor(contractAddress), 'hex'),
    value: amount,
  };
  logger.info(`Burning ${amount} tokens...`);
  const finalizedTxData = await modularContract.callTx.burn(
    coin,
    amount,
    coinKey(refundToCoinPublicKeyHex),
  );
  logger.info(`Burn tx ${finalizedTxData.public.txHash} in block ${finalizedTxData.public.blockHeight}`);
  return { tx: finalizedTxData.public, change: finalizedTxData.private.result };
};

///////////////////////////////////////////////////////////////////////////////
// WALLET SYNC
///////////////////////////////////////////////////////////////////////////////

/** Default bound for any "wait until the wallet is usable" call. */
const SYNC_TIMEOUT_MS = 10 * 60 * 1000;

/** Bound for waiting on DUST registration to be usable. */
const DUST_TIMEOUT_MS = Number(process.env.DUST_TIMEOUT_MS ?? 5 * 60 * 1000);

/**
 * A freshly started chain cannot balance transaction fees for the first ~30-60
 * seconds, even though the wallet reports itself synced with a large DUST
 * balance. Measured on a cold standalone stack: a deploy attempted ~15s after
 * the containers report healthy fails with "Insufficient Funds: could not
 * balance dust", while the same deploy against a stack ~45s old succeeds on the
 * first try. The DUST itself is not the problem (generated DUST is already at
 * its cap, ~340,000x a fee); the ledger's dust *generation info* for those coins
 * is not resolvable yet, and the balancer silently drops every coin it cannot
 * resolve, so coverage is zero.
 *
 * We cannot observe that state from outside the SDK, so rather than gate on a
 * proxy we retry the operation itself and let it succeed once the chain is
 * ready. Non-dust failures (e.g. "Ownable: caller is not the owner") do not
 * match and propagate immediately.
 */
const DUST_RETRY_ATTEMPTS = Number(process.env.DUST_RETRY_ATTEMPTS ?? 8);
const DUST_RETRY_DELAY_MS = Number(process.env.DUST_RETRY_DELAY_MS ?? 15_000);

const isTransientDustFailure = (e: unknown): boolean => {
  const message = e instanceof Error ? e.message : String(e);
  return /could not balance dust|insufficient funds/i.test(message);
};

const withDustRetry = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isTransientDustFailure(e) || attempt >= DUST_RETRY_ATTEMPTS) throw e;
      logger.warn(
        `${label}: could not balance fees (attempt ${attempt}/${DUST_RETRY_ATTEMPTS}). ` +
          `A freshly started chain needs a moment before it can pay fees. ` +
          `Retrying in ${Math.round(DUST_RETRY_DELAY_MS / 1000)}s.`,
      );
      await new Promise((resolve) => setTimeout(resolve, DUST_RETRY_DELAY_MS));
    }
  }
};

/** The state type the facade's observable emits. */
type WalletState = Rx.ObservedValueOf<ReturnType<WalletFacade['state']>>;

/**
 * Synced means the facade's own `state.isSynced`: every sub-wallet fully
 * applied, zero lag, in the same emission.
 *
 * Do NOT relax this to `SyncProgress.isCompleteWithin(n)`. A tolerated lag lets
 * the code proceed against a wallet that has not yet applied the blocks holding
 * its funds — measured here as a dust wallet 49 blocks behind, which then fails
 * the very next deploy with "Insufficient Funds: could not balance dust". The
 * strictness is the correctness gate; the fix for slow syncs is the bounded
 * wait below, not a looser predicate.
 */
const isSynced = (state: WalletState): boolean => state.isSynced;

/**
 * Best-effort per-sub-wallet sync detail for logs and timeout messages, so a
 * stalled sync is distinguishable from a merely slow one. Reaches into SDK
 * internals that differ in shape per sub-wallet, so every field is optional and
 * rendered as `?` when absent — this is a diagnostic, never a control path.
 */
const syncDiagnostics = (state: WalletState | undefined): string => {
  if (state == null) return 'no wallet state observed';
  const anyState = state as any;
  const parts: Record<string, any> = {
    shielded: anyState?.shielded?.state?.progress,
    dust: anyState?.dust?.state?.progress,
    unshielded: anyState?.unshielded?.progress,
  };
  const rendered = Object.entries(parts).map(([name, p]) => {
    if (p == null) return `${name}=<unavailable>`;
    const show = (v: unknown) => (v === undefined ? '?' : String(v));
    return `${name}{connected=${show(p.isConnected)}, applied=${show(p.appliedIndex)}, tip=${show(p.highestRelevantWalletIndex)}}`;
  });
  return `synced=${!!anyState?.isSynced} ${rendered.join(' ')}`;
};

/**
 * Waits for the wallet to report itself synced, bounded by a timeout that
 * reports WHY it gave up (which sub-wallet, connected or not, how far behind)
 * plus the indexer URL to check.
 *
 * Nothing throttles the state stream: the previous version applied
 * `throttleTime` upstream of the filter, which samples one state per window and
 * discards the rest, so a synced emission arriving mid-window was thrown away
 * and the wait could miss it entirely. Only the logging is rate-limited.
 */
const firstSyncedState = async (
  wallet: WalletFacade,
  label: string,
  timeoutMs = SYNC_TIMEOUT_MS,
  indexerUrl?: string,
): Promise<WalletState> => {
  let lastSeen: WalletState | undefined;
  let lastLoggedAt = 0;
  try {
    return await Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.tap((state) => {
          lastSeen = state;
          // Throttle only the logging, never the stream.
          if (Date.now() - lastLoggedAt >= 5_000) {
            lastLoggedAt = Date.now();
            logger.info(`${label}: waiting for sync. ${syncDiagnostics(state)}`);
          }
        }),
        Rx.filter((state) => isSynced(state)),
        Rx.timeout({ first: timeoutMs }),
      ),
    );
  } catch (e) {
    if (e instanceof Rx.TimeoutError) {
      throw new Error(
        `${label}: wallet did not sync within ${Math.round(timeoutMs / 1000)}s. ` +
          `Last state: ${syncDiagnostics(lastSeen)}. ` +
          (indexerUrl ? `Check the indexer at ${indexerUrl}. ` : '') +
          `If a sub-wallet shows connected=false the wallet cannot reach the indexer from this host ` +
          `(check the mapped port and docker host); if it is connected but applied is stuck, the ` +
          `indexer is not serving this wallet's sync stream.`,
      );
    }
    throw e;
  }
};

/** The wallet's synced shielded balance for a token color (raw hex). */
export const getShieldedTokenBalance = async (
  walletContext: WalletContext,
  colorRawHex: string,
): Promise<bigint> => {
  const state = await firstSyncedState(walletContext.wallet, 'getShieldedTokenBalance');
  return state.shielded?.balances[colorRawHex] ?? 0n;
};

/** Polls the wallet until the shielded balance for `colorRawHex` is at least `minimum`. */
export const waitForShieldedTokenBalance = (
  walletContext: WalletContext,
  colorRawHex: string,
  minimum: bigint,
  timeoutMs = 90_000,
): Promise<bigint> =>
  Rx.firstValueFrom(
    walletContext.wallet.state().pipe(
      Rx.throttleTime(3_000),
      Rx.tap((state) => {
        const balance = state.shielded?.balances[colorRawHex] ?? 0n;
        logger.info(`Waiting for token balance >= ${minimum}. Synced: ${state.isSynced}, balance: ${balance}`);
      }),
      Rx.map((state) => state.shielded?.balances[colorRawHex] ?? 0n),
      Rx.filter((balance) => balance >= minimum),
      Rx.timeout({ first: timeoutMs }),
    ),
  );

/**
 * Sign all unshielded offers in a transaction's intents, using the correct
 * proof marker for Intent.deserialize. This works around a bug in the wallet
 * SDK where signRecipe hardcodes 'pre-proof', which fails for proven
 * (UnboundTransaction) intents that contain 'proof' data.
 */
const signTransactionIntents = (
  tx: { intents?: Map<number, any> },
  signFn: (_payload: Uint8Array) => ledger.Signature,
  proofMarker: 'proof' | 'pre-proof',
): void => {
  if (!tx.intents || tx.intents.size === 0) return;

  for (const segment of tx.intents.keys()) {
    const intent = tx.intents.get(segment);
    if (!intent) continue;

    // Clone the intent with the correct proof marker.
    // The wallet SDK bug hardcodes 'pre-proof' here, which fails for
    // proven (UnboundTransaction) intents that use 'proof'.
    const cloned = ledger.Intent.deserialize<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>(
      'signature',
      proofMarker,
      'pre-binding',
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

export const createWalletAndMidnightProvider = async (
  walletContext: WalletContext,
): Promise<types.WalletProvider & types.MidnightProvider> => {
  const state = await firstSyncedState(walletContext.wallet, 'createWalletAndMidnightProvider');

  return {
    getCoinPublicKey(): ledger.CoinPublicKey {
      return state.shielded.coinPublicKey.toHexString();
    },
    getEncryptionPublicKey(): ledger.EncPublicKey {
      return state.shielded.encryptionPublicKey.toHexString();
    },
    async balanceTx(tx, ttl) {
      // Use the wallet facade to balance the transaction
      const recipe = await walletContext.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletContext.shieldedSecretKeys, dustSecretKey: walletContext.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      const signFn = (payload: Uint8Array) => walletContext.unshieldedKeystore.signData(payload);
      signTransactionIntents(recipe.baseTransaction, signFn, 'proof');
      if (recipe.balancingTransaction) {
        signTransactionIntents(recipe.balancingTransaction, signFn, 'pre-proof');
      }

      return walletContext.wallet.finalizeRecipe(recipe);
    },
    async submitTx(tx: ledger.FinalizedTransaction): Promise<ledger.TransactionId> {
      return await walletContext.wallet.submitTransaction(tx);
    },
  };
};

export const waitForSync = (wallet: WalletFacade, timeoutMs = SYNC_TIMEOUT_MS, indexerUrl?: string) =>
  firstSyncedState(wallet, 'waitForSync', timeoutMs, indexerUrl);

const nativeBalance = (state: any): bigint =>
  (state.unshielded?.balances[ledger.nativeToken().raw] ?? 0n) +
  (state.shielded?.balances[ledger.nativeToken().raw] ?? 0n);

export const waitForFunds = async (
  wallet: WalletFacade,
  timeoutMs = SYNC_TIMEOUT_MS,
  indexerUrl?: string,
): Promise<bigint> => {
  let lastSeen: WalletState | undefined;
  let lastLoggedAt = 0;
  try {
    return await Rx.firstValueFrom(
      wallet.state().pipe(
        Rx.tap((state) => {
          lastSeen = state;
          if (Date.now() - lastLoggedAt >= 10_000) {
            lastLoggedAt = Date.now();
            logger.info(`Waiting for funds. balance=${nativeBalance(state)} ${syncDiagnostics(state)}`);
          }
        }),
        // Filter first, throttle never: a funded state must not be sampled away.
        Rx.filter((state) => isSynced(state)),
        Rx.map((state) => nativeBalance(state)),
        Rx.filter((balance) => balance > 0n),
        Rx.timeout({ first: timeoutMs }),
      ),
    );
  } catch (e) {
    if (e instanceof Rx.TimeoutError) {
      throw new Error(
        `waitForFunds: no funds arrived within ${Math.round(timeoutMs / 1000)}s. ` +
          `Last balance: ${lastSeen ? nativeBalance(lastSeen) : 'unknown'}. ` +
          `Sync state: ${syncDiagnostics(lastSeen)}. ` +
          (indexerUrl ? `Check the indexer at ${indexerUrl}.` : ''),
      );
    }
    throw e;
  }
};

const makeTxHistoryStorage = () =>
  new InMemoryTransactionHistoryStorage(TransactionHistoryStorage.TransactionHistoryCommonSchema);

const buildShieldedConfig = ({ indexer, indexerWS, node, proofServer }: Config) => ({
  networkId: networkId.getNetworkId(),
  indexerClientConnection: {
    indexerHttpUrl: indexer,
    indexerWsUrl: indexerWS,
  },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, 'ws')),
  txHistoryStorage: makeTxHistoryStorage(),
});

const buildUnshieldedConfig = ({ indexer, indexerWS }: Config) => ({
  networkId: networkId.getNetworkId(),
  indexerClientConnection: {
    indexerHttpUrl: indexer,
    indexerWsUrl: indexerWS,
  },
  txHistoryStorage: makeTxHistoryStorage(),
});

const buildDustConfig = ({ indexer, indexerWS, node, proofServer }: Config) => ({
  networkId: networkId.getNetworkId(),
  costParameters: {
    additionalFeeOverhead: 300_000_000_000_000n,
    feeBlocksMargin: 5,
  },
  indexerClientConnection: {
    indexerHttpUrl: indexer,
    indexerWsUrl: indexerWS,
  },
  provingServerUrl: new URL(proofServer),
  relayURL: new URL(node.replace(/^http/, 'ws')),
  txHistoryStorage: makeTxHistoryStorage(),
});

/**
 * Derive HD wallet keys for all three roles (Zswap, NightExternal, Dust)
 * from a hex-encoded seed using BIP-44 style derivation at account 0, index 0.
 */
const deriveKeysFromSeed = (seed: string) => {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seed, 'hex'));
  if (hdWallet.type !== 'seedOk') {
    throw new Error('Failed to initialize HDWallet from seed');
  }

  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (derivationResult.type !== 'keysDerived') {
    throw new Error('Failed to derive keys');
  }

  hdWallet.hdWallet.clear();
  return derivationResult.keys;
};

/**
 * Formats a token balance for display (e.g. 1000000000 -> "1,000,000,000").
 */
const formatBalance = (balance: bigint): string => balance.toLocaleString();

/**
 * Runs an async operation with an animated spinner on the console.
 * Shows ⠋⠙⠹... while running, then ✓ on success or ✗ on failure.
 */
export const withStatus = async <T>(message: string, fn: () => Promise<T>): Promise<T> => {
  // `\r` only redraws in place on a terminal. Piped into a file or a CI log it
  // appends every frame instead, so a multi-minute wait emits thousands of
  // spinner copies. Print one line and skip the animation when not a TTY.
  const isTty = process.stdout.isTTY === true;
  if (!isTty) {
    process.stdout.write(`  … ${message}\n`);
    try {
      const result = await fn();
      process.stdout.write(`  ✓ ${message}\n`);
      return result;
    } catch (e) {
      process.stdout.write(`  ✗ ${message}\n`);
      throw e;
    }
  }

  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r  ${frames[i++ % frames.length]} ${message}`);
  }, 80);
  try {
    const result = await fn();
    clearInterval(interval);
    process.stdout.write(`\r  ✓ ${message}\n`);
    return result;
  } catch (e) {
    clearInterval(interval);
    process.stdout.write(`\r  ✗ ${message}\n`);
    throw e;
  }
};

/**
 * Registers unshielded NIGHT UTXOs for dust generation and waits until DUST is
 * actually spendable.
 *
 * NIGHT generates DUST over time, and only once the UTXOs are designated for
 * generation. DUST is the non-transferable fee token.
 *
 * The subtlety that makes or breaks a cold start: DUST **accrues**. Each coin
 * generates from its `ctime` toward a cap over `timeToCapSeconds`, and the
 * transaction balancer can only spend what has generated *so far*
 * (`getAvailableCoinsWithGeneratedDust` → `generatedNow`). `state.dust.balance()`
 * reports the projected cap instead, so a chain that started seconds ago
 * advertises an enormous DUST balance (measured: 1.25e24) while the amount
 * actually spendable is far below a single transaction fee (measured: ~4.9e14).
 *
 * Gating on coin count or on `balance()` therefore passes immediately and the
 * next transaction dies with "Insufficient Funds: could not balance dust" — the
 * cold-start failure a clean machine or CI hits every time and a warm chain
 * never does. `waitForGeneratedDust` is the SDK primitive that polls the
 * generated amount, so that is what we gate on.
 */
const registerForDustGeneration = async (
  wallet: WalletFacade,
  unshieldedKeystore: UnshieldedKeystore,
): Promise<void> => {
  const state = await firstSyncedState(wallet, 'registerForDustGeneration');

  const nightUtxos = state.unshielded.availableCoins;
  if (nightUtxos.length === 0) {
    console.log('  ! No NIGHT UTXOs available — fund this wallet before transacting.');
    return;
  }

  const unregistered = nightUtxos.filter((coin: any) => coin.meta?.registeredForDustGeneration !== true);

  if (unregistered.length === 0) {
    // Already designated — typically the `dev` genesis preset, which registers
    // the genesis wallet's NIGHT for us. Note that DUST being registered is not
    // the same as fees being payable yet; see withDustRetry.
    const dustBal = state.dust.balance(new Date());
    console.log(`  ✓ NIGHT already registered for dust generation (${formatBalance(dustBal)} DUST projected)`);
    return;
  }

  // A registration transaction pays its own fee, so enough DUST has to exist
  // before it can be submitted (the SDK's guidance for pairing
  // estimateRegistration with waitForGeneratedDust).
  const { fee } = await wallet.estimateRegistration(unregistered);
  if (fee > 0n) {
    await withStatus('Waiting for DUST to cover the registration fee', () =>
      wallet.waitForGeneratedDust(unregistered, fee, { timeoutMs: DUST_TIMEOUT_MS }),
    );
  }
  await withStatus(`Registering ${unregistered.length} NIGHT UTXO(s) for dust generation`, () =>
    withDustRetry('registerForDustGeneration', async () => {
      const recipe = await wallet.registerNightUtxosForDustGeneration(
        unregistered,
        unshieldedKeystore.getPublicKey(),
        (payload) => unshieldedKeystore.signData(payload),
      );
      const finalized = await wallet.finalizeRecipe(recipe);
      await wallet.submitTransaction(finalized);
    }),
  );
};

const printWalletSummary = (seed: string, state: any, unshieldedKeystore: UnshieldedKeystore) => {
  const networkId_ = networkId.getNetworkId();
  const unshieldedBalance = state.unshielded.balances[ledger.unshieldedToken().raw] ?? 0n;

  // Build the bech32m shielded address from coin + encryption public keys
  const coinPubKey = ShieldedCoinPublicKey.fromHexString(state.shielded.coinPublicKey.toHexString());
  const encPubKey = ShieldedEncryptionPublicKey.fromHexString(state.shielded.encryptionPublicKey.toHexString());
  const shieldedAddress = MidnightBech32m.encode(networkId_, new ShieldedAddress(coinPubKey, encPubKey)).toString();

  const DIV = '──────────────────────────────────────────────────────────────';

  console.log(`
${DIV}
  Wallet Overview                            Network: ${networkId_}
${DIV}
  Seed: ${seed}
${DIV}

  Shielded (ZSwap)
  └─ Address: ${shieldedAddress}

  Unshielded
  ├─ Address: ${unshieldedKeystore.getBech32Address()}
  └─ Balance: ${formatBalance(unshieldedBalance)} tNight

  Dust
  └─ Address: ${state.dust.dustAddress}

${DIV}`);
};

/**
 * Build (or restore) a wallet from a hex seed, then wait for the wallet
 * to sync and receive funds before returning.
 *
 * Steps:
 *   1. Derive HD keys (Zswap, NightExternal, Dust) from the seed
 *   2. Create the three sub-wallets (Shielded, Unshielded, Dust)
 *   3. Start the WalletFacade and wait for sync
 *   4. Display a wallet summary with all addresses
 *   5. If balance is zero, wait for incoming funds (e.g. from faucet)
 */
export const buildWalletAndWaitForFunds = async (config: Config, seed: string): Promise<WalletContext> => {
  console.log('');

  // Derive HD keys and initialize the three sub-wallets
  const { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore } = await withStatus(
    'Building wallet',
    async () => {
      const keys = deriveKeysFromSeed(seed);
      const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
      const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
      const unshieldedKeystore = createKeystore(keys[Roles.NightExternal], networkId.getNetworkId());

      const shieldedWallet = ShieldedWallet(buildShieldedConfig(config)).startWithSecretKeys(shieldedSecretKeys);
      const unshieldedWallet = UnshieldedWallet(buildUnshieldedConfig(config)).startWithPublicKey(
        PublicKey.fromKeyStore(unshieldedKeystore),
      );
      const dustWallet = DustWallet(buildDustConfig(config)).startWithSecretKey(
        dustSecretKey,
        ledger.LedgerParameters.initialParameters().dust,
      );

      const wallet = await WalletFacade.init({
        configuration: {
          ...buildShieldedConfig(config),
          ...buildUnshieldedConfig(config),
          ...buildDustConfig(config),
        },
        shielded: () => shieldedWallet,
        unshielded: () => unshieldedWallet,
        dust: () => dustWallet,
      });
      await wallet.start(shieldedSecretKeys, dustSecretKey);

      return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
    },
  );

  // Show seed and unshielded address immediately so user can fund via faucet while syncing
  const networkId_ = networkId.getNetworkId();
  const DIV = '──────────────────────────────────────────────────────────────';
  console.log(`
${DIV}
  Wallet Overview                            Network: ${networkId_}
${DIV}
  Seed: ${seed}

  Unshielded Address (send tNight here):
  ${unshieldedKeystore.getBech32Address()}
${
  networkId_ === 'preview' || networkId_ === 'preprod'
    ? `
  Fund your wallet with tNight from the ${networkId_} faucet:
  https://faucet.${networkId_}.midnight.network/
`
    : ''
}${DIV}
`);

  // Wait for the wallet to sync with the network
  const syncedState = await withStatus('Syncing with network', () =>
    waitForSync(wallet, SYNC_TIMEOUT_MS, config.indexer),
  );

  // Display the full wallet summary with all addresses and balances
  printWalletSummary(seed, syncedState, unshieldedKeystore);

  // Check if wallet has funds; if not, wait for incoming tokens
  const balance = syncedState.unshielded.balances[ledger.unshieldedToken().raw] ?? 0n;
  if (balance === 0n) {
    const fundedBalance = await withStatus('Waiting for incoming tokens', () =>
      waitForFunds(wallet, SYNC_TIMEOUT_MS, config.indexer),
    );
    console.log(`    Balance: ${formatBalance(fundedBalance)} tNight\n`);
  }

  // Register NIGHT UTXOs for dust generation (required for tx fees on Preprod/Preview)
  await registerForDustGeneration(wallet, unshieldedKeystore);

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

export const buildFreshWallet = async (config: Config): Promise<WalletContext> =>
  await buildWalletAndWaitForFunds(config, utils.toHex(Buffer.from(generateRandomSeed())));

export const configureProviders = async (
  walletContext: WalletContext,
  config: Config,
): Promise<ModularProviders> => {
  const walletAndMidnightProvider = await createWalletAndMidnightProvider(walletContext);
  const zkConfigProvider = new NodeZkConfigProvider<ModularCircuits>(contractConfig.zkConfigPath);
  return {
    //AES-256-GCM + PBKDF2
    // WalletProvider for encryption uses Encryption Public Key (EPK)
    privateStateProvider: levelPrivateStateProvider<typeof ModularPrivateStateId>({
      privateStateStoreName: contractConfig.privateStateStoreName,
      signingKeyStoreName: 'signing-keys',
      midnightDbName: 'midnight-level-db',
      privateStoragePasswordProvider: () => 'Xk9#mPw2$nLq5RvJ',
      accountId: walletContext.unshieldedKeystore.getAddress(),
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
};

/**
 * Get the current DUST balance from the wallet state.
 */
export const getDustBalance = async (
  wallet: WalletFacade,
): Promise<{ available: bigint; pending: bigint; availableCoins: number; pendingCoins: number }> => {
  const state = await firstSyncedState(wallet, 'getDustBalance');
  const available = state.dust.balance(new Date());
  const availableCoins = state.dust.availableCoins.length;
  const pendingCoins = state.dust.pendingCoins.length;
  // Sum pending coin initial values for a rough pending balance
  const pending = state.dust.pendingCoins.reduce((sum, c) => sum + c.token.initialValue, 0n);
  return { available, pending, availableCoins, pendingCoins };
};

/**
 * Monitor DUST balance with a live-updating display.
 * Prints a status line every 5 seconds showing balance, coins, and status.
 * Resolves when the user presses Enter (via the provided signal).
 */
export const monitorDustBalance = async (wallet: WalletFacade, stopSignal: Promise<void>): Promise<void> => {
  let stopped = false;
  void stopSignal.then(() => {
    stopped = true;
  });

  const sub = wallet
    .state()
    .pipe(
      Rx.throttleTime(5_000),
      Rx.filter((s) => s.isSynced),
    )
    .subscribe((state) => {
      if (stopped) return;

      const now = new Date();
      const available = state.dust.balance(now);
      const availableCoins = state.dust.availableCoins.length;
      const pendingCoins = state.dust.pendingCoins.length;

      const registeredNight = state.unshielded.availableCoins.filter(
        (coin: any) => coin.meta?.registeredForDustGeneration === true,
      ).length;
      const totalNight = state.unshielded.availableCoins.length;

      let status = '';
      if (pendingCoins > 0 && availableCoins === 0) {
        status = '⚠ locked by pending tx';
      } else if (available > 0n) {
        status = '✓ ready to deploy';
      } else if (availableCoins > 0) {
        status = 'accruing...';
      } else if (registeredNight > 0) {
        status = 'waiting for generation...';
      } else {
        status = 'no NIGHT registered';
      }

      const time = now.toLocaleTimeString();
      console.log(
        `  [${time}] DUST: ${formatBalance(available)} (${availableCoins} coins, ${pendingCoins} pending) | NIGHT: ${totalNight} UTXOs, ${registeredNight} registered | ${status}`,
      );
    });

  await stopSignal;
  sub.unsubscribe();
};

export const closeWallet = async (walletContext: WalletContext): Promise<void> => {
  try {
    await walletContext.wallet.stop();
  } catch (e) {
    logger.error(`Error closing wallet: ${e}`);
  }
};

export const waitForProofServer = async (config: Config, timeoutMs = 180_000): Promise<void> => {
  const versionUrl = new URL('/version', config.proofServer).toString();
  const deadline = Date.now() + timeoutMs;
  await withStatus('Waiting for proof server', async () => {
    for (;;) {
      try {
        const res = await fetch(versionUrl);
        if (res.ok) return;
      } catch {
        // not listening yet
      }
      if (Date.now() >= deadline) {
        throw new Error(`Proof server not ready at ${config.proofServer} after ${Math.round(timeoutMs / 1000)}s`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  });
};
