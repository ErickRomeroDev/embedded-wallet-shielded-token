import { Modular, type ModularPrivateState } from '@eddalabs/contract';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';
import { contracts, types } from '@midnight-ntwrk/midnight-js';

export type ModularCircuits = ProvableCircuitId<Modular.Contract<ModularPrivateState>>;

export const ModularPrivateStateId = 'modularPrivateState';

export type ModularProviders = types.MidnightProviders<ModularCircuits, typeof ModularPrivateStateId, ModularPrivateState>;

export type ModularContract = Modular.Contract<ModularPrivateState>;

export type DeployedModularContract = contracts.DeployedContract<ModularContract> | contracts.FoundContract<ModularContract>;

export type UserAction = {
  mint: string | undefined;
  burn: string | undefined;
};

// Encoded Compact types as emitted in the generated contract .d.ts.
export type CoinKey = { bytes: Uint8Array };
export type EncodedCoinInfo = { nonce: Uint8Array; color: Uint8Array; value: bigint };
export type MaybeCoinInfo = { is_some: boolean; value: EncodedCoinInfo };

// Hex-serializable form of a minted coin, for deployment records and logs.
// The coin info returned by mint is the recipient's ONLY copy — wallets
// cannot discover contract-minted coins by scanning the chain.
export type TokenCoinRecord = {
  nonceHex: string;
  colorHex: string;
  value: string;
};

export type TokenState = {
  name: string;
  symbol: string;
  decimals: bigint;
  domain: Uint8Array;
};

export type DerivedState = {
  // Owner commitment stored on the public ledger (hex), or null pre-join.
  readonly ownerCommitmentHex: string | null;
};

export const emptyState: DerivedState = {
  ownerCommitmentHex: null,
};
