import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  wit_OwnableSK(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  tokenColor(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  mint(context: __compactRuntime.CircuitContext<PS>,
       recipient_0: { bytes: Uint8Array },
       amount_0: bigint,
       nonce_0: Uint8Array): __compactRuntime.CircuitResults<PS, { nonce: Uint8Array,
                                                                   color: Uint8Array,
                                                                   value: bigint
                                                                 }>;
  burn(context: __compactRuntime.CircuitContext<PS>,
       coin_0: { nonce: Uint8Array, color: Uint8Array, value: bigint },
       amount_0: bigint,
       refundTo_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, { is_some: boolean,
                                                                                 value: { nonce: Uint8Array,
                                                                                          color: Uint8Array,
                                                                                          value: bigint
                                                                                        }
                                                                               }>;
  transferOwnership(context: __compactRuntime.CircuitContext<PS>,
                    newOwnerCommitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  tokenColor(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  mint(context: __compactRuntime.CircuitContext<PS>,
       recipient_0: { bytes: Uint8Array },
       amount_0: bigint,
       nonce_0: Uint8Array): __compactRuntime.CircuitResults<PS, { nonce: Uint8Array,
                                                                   color: Uint8Array,
                                                                   value: bigint
                                                                 }>;
  burn(context: __compactRuntime.CircuitContext<PS>,
       coin_0: { nonce: Uint8Array, color: Uint8Array, value: bigint },
       amount_0: bigint,
       refundTo_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, { is_some: boolean,
                                                                                 value: { nonce: Uint8Array,
                                                                                          color: Uint8Array,
                                                                                          value: bigint
                                                                                        }
                                                                               }>;
  transferOwnership(context: __compactRuntime.CircuitContext<PS>,
                    newOwnerCommitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
}

export type Circuits<PS> = {
  tokenColor(context: __compactRuntime.CircuitContext<PS>): __compactRuntime.CircuitResults<PS, Uint8Array>;
  mint(context: __compactRuntime.CircuitContext<PS>,
       recipient_0: { bytes: Uint8Array },
       amount_0: bigint,
       nonce_0: Uint8Array): __compactRuntime.CircuitResults<PS, { nonce: Uint8Array,
                                                                   color: Uint8Array,
                                                                   value: bigint
                                                                 }>;
  burn(context: __compactRuntime.CircuitContext<PS>,
       coin_0: { nonce: Uint8Array, color: Uint8Array, value: bigint },
       amount_0: bigint,
       refundTo_0: { bytes: Uint8Array }): __compactRuntime.CircuitResults<PS, { is_some: boolean,
                                                                                 value: { nonce: Uint8Array,
                                                                                          color: Uint8Array,
                                                                                          value: bigint
                                                                                        }
                                                                               }>;
  transferOwnership(context: __compactRuntime.CircuitContext<PS>,
                    newOwnerCommitment_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly Ownable__isInitialized: boolean;
  readonly Ownable__owner: { is_left: boolean,
                             left: Uint8Array,
                             right: { bytes: Uint8Array }
                           };
  readonly ShieldedToken__domain: Uint8Array;
  readonly ShieldedToken__isInitialized: boolean;
  readonly ShieldedToken__name: string;
  readonly ShieldedToken__symbol: string;
  readonly ShieldedToken__decimals: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               initialOwnerCommitment_0: Uint8Array,
               domainSep_0: Uint8Array,
               name__0: string,
               symbol__0: string,
               decimals__0: bigint): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
