import { createLogger } from "../../logger.js";
import { LogicTestingConfig } from "../../config.js";
import { player1 } from "../utils/utils.js";

import {
  Contract,
  type Ledger,
  ledger
} from "../../managed/modular/contract/index.js";
import {
  type ModularPrivateState,
  createPrivateState,
  witnesses
} from "../../witnesses.js";
import { makeDeployArgs } from "../../token-metadata.js";
import { computeOwnerCommitment } from "../../owner.js";

import {
  type CircuitContext,
  QueryContext,
  sampleContractAddress,
  createConstructorContext,
  CostModel,
  CircuitResults,
  CoinPublicKey,
  emptyZswapLocalState,
  ContractAddress
} from "@midnight-ntwrk/compact-runtime";

const config = new LogicTestingConfig();
export const logger = await createLogger(config.logDir);

// TS shapes of the Compact types, as emitted in managed/modular/contract/index.d.ts.
export type CoinKey = { bytes: Uint8Array };
export type CoinInfo = { nonce: Uint8Array; color: Uint8Array; value: bigint };
export type MaybeCoinInfo = { is_some: boolean; value: CoinInfo };

export class ModularSimulator {
  readonly contract: Contract<ModularPrivateState>;
  circuitContext: CircuitContext<ModularPrivateState>;
  userPrivateStates: Record<string, ModularPrivateState>;
  updateUserPrivateState: (_newPrivateState: ModularPrivateState) => void;
  contractAddress: ContractAddress;

  constructor(privateState: ModularPrivateState, ownerCommitment?: Uint8Array) {
    this.contract = new Contract<ModularPrivateState>(witnesses);
    this.contractAddress = sampleContractAddress();
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState
    } = this.contract.initialState(
      createConstructorContext(privateState, player1),
      // Deployer's commitment defaults to the hash of their own secret,
      // mirroring the passkey flow (commitment computed off-chain).
      ...makeDeployArgs(
        ownerCommitment ?? computeOwnerCommitment(privateState.ownableSecretKey)
      )
    );
    this.circuitContext = {
      currentPrivateState,
      currentZswapLocalState,
      currentQueryContext: new QueryContext(
        currentContractState.data,
        this.contractAddress
      ),
      costModel: CostModel.initialCostModel()
    };
    this.userPrivateStates = { ["p1"]: currentPrivateState };
    this.updateUserPrivateState = (_newPrivateState: ModularPrivateState) => {};
  }

  static deployContract(secretKey: Uint8Array): ModularSimulator {
    return new ModularSimulator(createPrivateState(secretKey));
  }

  createPrivateState(pName: string, secretKey: Uint8Array): void {
    this.userPrivateStates[pName] = createPrivateState(secretKey);
  }

  private buildTurnContext(
    currentPrivateState: ModularPrivateState
  ): CircuitContext<ModularPrivateState> {
    return {
      ...this.circuitContext,
      currentPrivateState
    };
  }

  private updateUserPrivateStateByName =
    (name: string) =>
    (newPrivateState: ModularPrivateState): void => {
      this.userPrivateStates[name] = newPrivateState;
    };

  as(name: string): ModularSimulator {
    const ps = this.userPrivateStates[name];
    if (!ps) {
      throw new Error(
        `No private state found for user '${name}'. Did you register it?`
      );
    }
    this.circuitContext = this.buildTurnContext(ps);
    this.updateUserPrivateState = this.updateUserPrivateStateByName(name);
    return this;
  }

  public getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public getPrivateState(): ModularPrivateState {
    return this.circuitContext.currentPrivateState;
  }

  public getCircuitContext(): CircuitContext<ModularPrivateState> {
    return this.circuitContext;
  }

  updateStateAndGetLedger<T>(
    circuitResults: CircuitResults<ModularPrivateState, T>
  ): Ledger {
    this.circuitContext = circuitResults.context;
    this.updateUserPrivateState(circuitResults.context.currentPrivateState);
    return this.getLedger();
  }

  private contextFor(
    sender?: CoinPublicKey
  ): CircuitContext<ModularPrivateState> {
    return {
      ...this.circuitContext,
      currentZswapLocalState: sender
        ? emptyZswapLocalState(sender)
        : this.circuitContext.currentZswapLocalState
    };
  }

  public tokenColor(sender?: CoinPublicKey): Uint8Array {
    const circuitResults = this.contract.impureCircuits.tokenColor(
      this.contextFor(sender)
    );
    this.updateStateAndGetLedger(circuitResults);
    return circuitResults.result;
  }

  public mint(
    recipient: CoinKey,
    amount: bigint,
    nonce: Uint8Array,
    sender?: CoinPublicKey
  ): { coin: CoinInfo; ledger: Ledger } {
    const circuitResults = this.contract.impureCircuits.mint(
      this.contextFor(sender),
      recipient,
      amount,
      nonce
    );

    logger.info({
      section: "MINT Circuit Results",
      gasCost: circuitResults.gasCost,
      result: circuitResults.result
    });

    return {
      coin: circuitResults.result,
      ledger: this.updateStateAndGetLedger(circuitResults)
    };
  }

  public burn(
    coin: CoinInfo,
    amount: bigint,
    refundTo: CoinKey,
    sender?: CoinPublicKey
  ): { change: MaybeCoinInfo; ledger: Ledger } {
    const circuitResults = this.contract.impureCircuits.burn(
      this.contextFor(sender),
      coin,
      amount,
      refundTo
    );

    logger.info({
      section: "BURN Circuit Results",
      gasCost: circuitResults.gasCost,
      result: circuitResults.result
    });

    return {
      change: circuitResults.result,
      ledger: this.updateStateAndGetLedger(circuitResults)
    };
  }

  public transferOwnership(
    newOwnerCommitment: Uint8Array,
    sender?: CoinPublicKey
  ): Ledger {
    const circuitResults = this.contract.impureCircuits.transferOwnership(
      this.contextFor(sender),
      newOwnerCommitment
    );

    logger.info({
      section: "TRANSFER OWNERSHIP Circuit Results",
      gasCost: circuitResults.gasCost
    });

    return this.updateStateAndGetLedger(circuitResults);
  }
}
