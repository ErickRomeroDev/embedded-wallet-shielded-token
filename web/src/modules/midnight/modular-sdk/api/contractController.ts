import { type Logger } from 'pino';
import { type ContractAddress, rawTokenType, toHex, fromHex } from '@midnight-ntwrk/compact-runtime';
import * as Rx from 'rxjs';
import {
  ModularPrivateStateId,
  ModularProviders,
  DeployedModularContract,
  emptyState,
  UserAction,
  type DerivedState,
  type CoinKey,
  type EncodedCoinInfo,
  type MintedCoin,
} from './common-types';
import { Modular, ModularPrivateState, createPrivateState, TOKEN_DOMAIN } from '@eddalabs/contract';
import { coinPublicKeyToHex } from '@/lib/coin-public-key';
import { contracts, types } from '@midnight-ntwrk/midnight-js';
import { CompiledContract } from '@midnight-ntwrk/compact-js';

const modularCompiledContract = CompiledContract.make('modular', Modular.Contract).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(`${window.location.origin}/midnight/modular`),
);

const MINTED_COINS_STORAGE_PREFIX = 'modular-sdk:minted-coins:';

/** Public outcome of a submitted transaction. */
export interface TxResult {
  txHash: string;
}

export interface ContractControllerInterface {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Rx.Observable<DerivedState>;
  /** The EDDA token color (raw hex): tokenType(domain, contractAddress). */
  readonly tokenColor: string;
  increment: () => Promise<TxResult>;
  mint: (amount: bigint) => Promise<TxResult>;
  burn: (amount: bigint) => Promise<TxResult>;
  getMintedCoins: () => MintedCoin[];
}

export class ContractController implements ContractControllerInterface {
  readonly deployedContractAddress: ContractAddress;
  readonly state$: Rx.Observable<DerivedState>;
  readonly privateStates$: Rx.Subject<ModularPrivateState>;
  readonly turns$: Rx.Subject<UserAction>;
  readonly tokenColor: string;

  private constructor(
    public readonly contractPrivateStateId: typeof ModularPrivateStateId,
    public readonly deployedContract: DeployedModularContract,
    public readonly providers: ModularProviders,
    private readonly logger: Logger,
  ) {
    const combine = (_acc: DerivedState, value: DerivedState): DerivedState => {
      return {
        round: value.round,
        privateState: value.privateState,
        turns: value.turns,
        tokenName: value.tokenName,
        tokenSymbol: value.tokenSymbol,
        tokenDecimals: value.tokenDecimals,
        tokenDomain: value.tokenDomain,
      };
    };
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
    // Off-chain color derivation; execution-verified against the tokenColor
    // circuit in the contract test suite — no transaction needed for reads.
    this.tokenColor = rawTokenType(TOKEN_DOMAIN, this.deployedContractAddress);
    this.turns$ = new Rx.Subject<UserAction>();
    this.privateStates$ = new Rx.Subject<ModularPrivateState>();
    this.state$ = Rx.combineLatest(
      [
        providers.publicDataProvider
          .contractStateObservable(this.deployedContractAddress, { type: 'all' })
          .pipe(Rx.map((contractState) => Modular.ledger(contractState.data))),
        Rx.concat(
          Rx.from(
            Rx.defer(() => providers.privateStateProvider.get(contractPrivateStateId) as Promise<ModularPrivateState>),
          ),
          this.privateStates$,
        ),
        Rx.concat(Rx.of<UserAction>({ increment: undefined, mint: undefined, burn: undefined }), this.turns$),
      ],
      (ledgerState, privateState, userActions) => {
        const result: DerivedState = {
          round: ledgerState.Counter__round,
          privateState: privateState,
          turns: userActions,
          tokenName: ledgerState.ShieldedToken__name,
          tokenSymbol: ledgerState.ShieldedToken__symbol,
          tokenDecimals: ledgerState.ShieldedToken__decimals,
          tokenDomain: ledgerState.ShieldedToken__domain,
        };
        return result;
      },
    ).pipe(
      Rx.scan(combine, emptyState),
      Rx.retry({
        // sometimes websocket fails, if want to add attempts, include count in the object
        delay: 500,
      }),
    );
  }

  async increment(): Promise<TxResult> {
    this.logger?.info('incrementing counter');
    this.turns$.next({ increment: 'incrementing the counter', mint: undefined, burn: undefined });

    try {
      const txData = await this.deployedContract.callTx.increment();
      this.logger?.trace({
        increment: {
          message: 'incrementing the counter - blockchain info',
          txHash: txData.public.txHash,
          blockHeight: txData.public.blockHeight,
        },
      });
      this.turns$.next({ increment: undefined, mint: undefined, burn: undefined });
      return { txHash: txData.public.txHash };
    } catch (e) {
      this.turns$.next({ increment: undefined, mint: undefined, burn: undefined });
      throw e;
    }
  }

  /**
   * Mints `amount` base units of EDDA to the connected wallet's own coin
   * public key, with a fresh secret random nonce (recipient-private mint).
   * The submitting wallet detects its own contract-minted coin by syncing
   * (execution-verified in the node test suite); the returned coin info is
   * additionally persisted to localStorage as the out-of-band record.
   */
  async mint(amount: bigint): Promise<TxResult> {
    this.logger?.info(`minting ${amount} token base units`);
    this.turns$.next({ increment: undefined, mint: 'minting tokens', burn: undefined });

    try {
      const recipient = this.ownRecipient();
      const nonce = crypto.getRandomValues(new Uint8Array(32));
      const txData = await this.deployedContract.callTx.mint(recipient, amount, nonce);
      const coin = txData.private.result;
      this.recordMintedCoin(coin, txData.public.txHash);
      this.logger?.trace({
        mint: {
          message: 'minted tokens - blockchain info',
          txHash: txData.public.txHash,
          blockHeight: txData.public.blockHeight,
        },
      });
      this.turns$.next({ increment: undefined, mint: undefined, burn: undefined });
      return { txHash: txData.public.txHash };
    } catch (e) {
      this.turns$.next({ increment: undefined, mint: undefined, burn: undefined });
      throw e;
    }
  }

  /**
   * Burns exactly `amount` base units of EDDA. A fresh coin of value `amount`
   * is paid into the transaction by the wallet during balancing (verified in
   * the node test suite), so the full-burn path always runs and no change coin
   * comes back to the user. `refundTo` is required to be non-zero by the
   * contract, so we pass our own key; it stays inert on a full burn.
   */
  async burn(amount: bigint): Promise<TxResult> {
    this.logger?.info(`burning ${amount} token base units`);
    this.turns$.next({ increment: undefined, mint: undefined, burn: 'burning tokens' });

    try {
      const coin: EncodedCoinInfo = {
        nonce: crypto.getRandomValues(new Uint8Array(32)),
        color: fromHex(this.tokenColor),
        value: amount,
      };
      const txData = await this.deployedContract.callTx.burn(coin, amount, this.ownRecipient());
      const change = txData.private.result;
      if (change.is_some) {
        // Defensive: cannot happen with coin.value === amount, but never drop a coin.
        this.recordMintedCoin(change.value, txData.public.txHash);
        this.logger?.warn({ burn: { message: 'unexpected change coin recorded', txHash: txData.public.txHash } });
      }
      this.logger?.trace({
        burn: {
          message: 'burned tokens - blockchain info',
          txHash: txData.public.txHash,
          blockHeight: txData.public.blockHeight,
        },
      });
      this.turns$.next({ increment: undefined, mint: undefined, burn: undefined });
      return { txHash: txData.public.txHash };
    } catch (e) {
      this.turns$.next({ increment: undefined, mint: undefined, burn: undefined });
      throw e;
    }
  }

  /** Coins minted from this browser, newest first (localStorage-backed). */
  getMintedCoins(): MintedCoin[] {
    try {
      const raw = localStorage.getItem(this.mintedCoinsKey());
      return raw ? (JSON.parse(raw) as MintedCoin[]) : [];
    } catch {
      return [];
    }
  }

  private ownRecipient(): CoinKey {
    // The wallet provider hands back the dapp-connector's Bech32m-encoded coin
    // public key; the circuit needs the raw 32 bytes.
    const coinPublicKey = this.providers.walletProvider.getCoinPublicKey();
    const hex = coinPublicKeyToHex(coinPublicKey as unknown as string);
    if (!hex) {
      throw new Error('Could not read your wallet coin public key — reconnect your wallet and try again.');
    }
    return { bytes: fromHex(hex) };
  }

  private mintedCoinsKey(): string {
    return `${MINTED_COINS_STORAGE_PREFIX}${this.deployedContractAddress}`;
  }

  private recordMintedCoin(coin: EncodedCoinInfo, txHash: string): void {
    const record: MintedCoin = {
      nonceHex: toHex(coin.nonce),
      colorHex: toHex(coin.color),
      value: coin.value.toString(),
      txHash,
      mintedAt: new Date().toISOString(),
    };
    try {
      const coins = [record, ...this.getMintedCoins()];
      localStorage.setItem(this.mintedCoinsKey(), JSON.stringify(coins));
    } catch (e) {
      this.logger?.warn({ mintedCoinRecord: { message: 'failed to persist minted coin', error: String(e) } });
    }
  }

  static async join(
    contractPrivateStateId: typeof ModularPrivateStateId,
    providers: ModularProviders,
    contractAddress: ContractAddress,
    logger: Logger,
  ): Promise<ContractController> {
    logger.info({
      joinContract: {
        action: "Joining contract",
        contractPrivateStateId,
        contractAddress,
      },
    });

    const deployedContract = await contracts.findDeployedContract(providers, {
      contractAddress,
      compiledContract: modularCompiledContract,
      privateStateId: contractPrivateStateId,
      initialPrivateState: await ContractController.getPrivateState(contractPrivateStateId, providers.privateStateProvider),
    });

    logger.trace({
      contractJoined: {
        action: "Join the contract successfully",
        contractPrivateStateId,
        finalizedDeployTxData: deployedContract.deployTxData.public,
      },
    });

    return new ContractController(contractPrivateStateId, deployedContract, providers, logger);
  }

  private static async getPrivateState(
    modularPrivateStateId: typeof ModularPrivateStateId,
    privateStateProvider: types.PrivateStateProvider<typeof ModularPrivateStateId, ModularPrivateState>,
  ): Promise<ModularPrivateState> {
    const existingPrivateState = await privateStateProvider.get(modularPrivateStateId);
    const initialState = await this.getOrCreateInitialPrivateState(modularPrivateStateId, privateStateProvider);
    return existingPrivateState ?? initialState;
  }

  static async getOrCreateInitialPrivateState(
    modularPrivateStateId: typeof ModularPrivateStateId,
    privateStateProvider: types.PrivateStateProvider<typeof ModularPrivateStateId, ModularPrivateState>,
  ): Promise<ModularPrivateState> {
    let state = await privateStateProvider.get(modularPrivateStateId);

    if (state === null) {
      state = this.createPrivateState(0);
      await privateStateProvider.set(modularPrivateStateId, state);
    }
    return state;
  }

  private static createPrivateState(value: number): ModularPrivateState {
    return createPrivateState(value);
  }
}
