import { createLogger } from "../../logger.js";
import { LogicTestingConfig } from "../../config.js";
import { player1 } from "../counter.test.js";

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
import { DEPLOY_ARGS } from "../../token-metadata.js";

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
  updateUserPrivateState: (newPrivateState: ModularPrivateState) => void;
  contractAddress: ContractAddress;

  constructor(privateState: ModularPrivateState) {
    this.contract = new Contract<ModularPrivateState>(witnesses);
    this.contractAddress = sampleContractAddress();
    const {
      currentPrivateState,
      currentContractState,
      currentZswapLocalState
    } = this.contract.initialState(
      createConstructorContext(
        { privateCounter: privateState.privateCounter },
        player1
      ),
      ...DEPLOY_ARGS
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
    this.updateUserPrivateState = (newPrivateState: ModularPrivateState) => {};
  }

  static deployContract(secretKey: number): ModularSimulator {
    return new ModularSimulator(createPrivateState(secretKey));
  }

  createPrivateState(pName: string, secretKey: number): void {
    this.userPrivateStates[pName] = createPrivateState(secretKey);
  }

  private buildTurnContext(
    currentPrivateState: ModularPrivateState
  ): CircuitContext<ModularPrivateState> {
    return {
      ...this.circuitContext,
      currentPrivateState,
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

  private contextFor(sender?: CoinPublicKey): CircuitContext<ModularPrivateState> {
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

  public increment(sender?: CoinPublicKey): Ledger {
    // Update the current context to be the result of executing the circuit.
    const circuitResults = this.contract.impureCircuits.increment({
      ...this.circuitContext,
      currentZswapLocalState: sender
        ? emptyZswapLocalState(sender)
        : this.circuitContext.currentZswapLocalState
    }); 

    logger.info("INCREMET CIRCUIT");
    logger.info({
      section: "Circuit Results",
      gasCost: circuitResults.gasCost,
      proofData: circuitResults.proofData,
      result: circuitResults.result
    });

    return this.updateStateAndGetLedger(circuitResults);
  }
}
