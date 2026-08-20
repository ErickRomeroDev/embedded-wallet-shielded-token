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
import {
  Modular,
  ModularPrivateState,
  createPrivateState,
  emptyPrivateState,
  computeOwnerCommitment,
  witnesses,
  TOKEN_DOMAIN,
} from '@eddalabs/contract';
import { coinPublicKeyToHex } from '@/lib/coin-public-key';
import { contracts } from '@midnight-ntwrk/midnight-js';
import { CompiledContract } from '@midnight-ntwrk/compact-js';

const modularCompiledContract = CompiledContract.make('modular', Modular.Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
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
  /** The MKT token color (raw hex): tokenType(domain, contractAddress). */
  readonly tokenColor: string;
  /** This session's owner commitment (hex), or null without a passkey session. */
  readonly myCommitmentHex: string | null;
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
  readonly myCommitmentHex: string | null;

  private constructor(
    public readonly contractPrivateStateId: typeof ModularPrivateStateId,
    public readonly deployedContract: DeployedModularContract,
    public readonly providers: ModularProviders,
    private readonly logger: Logger,
    myCommitmentHex: string | null,
  ) {
    const combine = (_acc: DerivedState, value: DerivedState): DerivedState => {
      return {
        privateState: value.privateState,
        turns: value.turns,
        tokenName: value.tokenName,
        tokenSymbol: value.tokenSymbol,
        tokenDecimals: value.tokenDecimals,
        tokenDomain: value.tokenDomain,
        ownerCommitmentHex: value.ownerCommitmentHex,
        isOwner: value.isOwner,
      };
    };
    this.deployedContractAddress = deployedContract.deployTxData.public.contractAddress;
    // Off-chain color derivation; execution-verified against the tokenColor
    // circuit in the contract test suite — no transaction needed for reads.
    this.tokenColor = rawTokenType(TOKEN_DOMAIN, this.deployedContractAddress);
    this.myCommitmentHex = myCommitmentHex;
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
        Rx.concat(Rx.of<UserAction>({ mint: undefined, burn: undefined }), this.turns$),
      ],
      (ledgerState, privateState, userActions) => {
        const ownerCommitmentHex = ledgerState.Ownable__owner.is_left
          ? toHex(ledgerState.Ownable__owner.left)
          : null;
        const result: DerivedState = {
          privateState: privateState,
          turns: userActions,
          tokenName: ledgerState.ShieldedToken__name,
          tokenSymbol: ledgerState.ShieldedToken__symbol,
          tokenDecimals: ledgerState.ShieldedToken__decimals,
          tokenDomain: ledgerState.ShieldedToken__domain,
          ownerCommitmentHex,
          isOwner: this.myCommitmentHex !== null && this.myCommitmentHex === ownerCommitmentHex,
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

  /**
   * Mints `amount` base units of MKT to the connected wallet's own coin
   * public key, with a fresh secret random nonce (recipient-private mint).
   * Owner-gated: proving succeeds only when the session's passkey-derived
   * secret hashes to the on-chain owner commitment.
   * The submitting wallet detects its own contract-minted coin by syncing
   * (execution-verified in the node test suite); the returned coin info is
   * additionally persisted to localStorage as the out-of-band record.
   */
  async mint(amount: bigint): Promise<TxResult> {
    this.logger?.info(`minting ${amount} token base units`);
    this.turns$.next({ mint: 'minting tokens', burn: undefined });

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
      this.turns$.next({ mint: undefined, burn: undefined });
      return { txHash: txData.public.txHash };
    } catch (e) {
      this.turns$.next({ mint: undefined, burn: undefined });
      throw e;
    }
  }

  /**
   * Burns exactly `amount` base units of MKT (owner-gated, like mint). A fresh
   * coin of value `amount` is paid into the transaction by the wallet during
   * balancing (verified in the node test suite), so the full-burn path always
   * runs and no change coin comes back to the user. `refundTo` is required to
   * be non-zero by the contract, so we pass our own key; it stays inert on a
   * full burn.
   */
  async burn(amount: bigint): Promise<TxResult> {
    this.logger?.info(`burning ${amount} token base units`);
    this.turns$.next({ mint: undefined, burn: 'burning tokens' });

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
      this.turns$.next({ mint: undefined, burn: undefined });
      return { txHash: txData.public.txHash };
    } catch (e) {
      this.turns$.next({ mint: undefined, burn: undefined });
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

  /**
   * Joins the deployed contract. When `ownerSecretKey` is provided (embedded
   * passkey session) it becomes the private state backing wit_OwnableSK, so
   * owner-gated circuits can prove ownership; otherwise the zero secret is
   * used and mint/burn will be rejected by the contract.
   */
  static async join(
    contractPrivateStateId: typeof ModularPrivateStateId,
    providers: ModularProviders,
    contractAddress: ContractAddress,
    logger: Logger,
    ownerSecretKey?: Uint8Array | null,
  ): Promise<ContractController> {
    logger.info({
      joinContract: {
        action: "Joining contract",
        contractPrivateStateId,
        contractAddress,
        withOwnerSecret: !!ownerSecretKey,
      },
    });

    const privateState = ownerSecretKey ? createPrivateState(ownerSecretKey) : emptyPrivateState();
    // Overwrite any previously stored private state: the secret is
    // re-derivable from the passkey on every connect, and a stale zero secret
    // must not shadow a live owner session (or vice versa).
    await providers.privateStateProvider.set(contractPrivateStateId, privateState);

    const deployedContract = await contracts.findDeployedContract(providers, {
      contractAddress,
      compiledContract: modularCompiledContract,
      privateStateId: contractPrivateStateId,
      initialPrivateState: privateState,
    });

    logger.trace({
      contractJoined: {
        action: "Join the contract successfully",
        contractPrivateStateId,
        finalizedDeployTxData: deployedContract.deployTxData.public,
      },
    });

    const myCommitmentHex = ownerSecretKey ? toHex(computeOwnerCommitment(ownerSecretKey)) : null;
    return new ContractController(contractPrivateStateId, deployedContract, providers, logger, myCommitmentHex);
  }
}
