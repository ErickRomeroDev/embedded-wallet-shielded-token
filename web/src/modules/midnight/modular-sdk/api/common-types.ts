import { type ModularPrivateState, Modular, emptyPrivateState } from '@eddalabs/contract';
import type { ProvableCircuitId } from '@midnight-ntwrk/compact-js';
import { contracts, types } from '@midnight-ntwrk/midnight-js';

export type ModularCircuits = ProvableCircuitId<Modular.Contract<ModularPrivateState>>;

export const ModularPrivateStateId = 'modularPrivateState';

export type ModularProviders = types.MidnightProviders<ModularCircuits, typeof ModularPrivateStateId, ModularPrivateState>;

export type ModularContract = Modular.Contract<ModularPrivateState>;

export type DeployedModularContract = contracts.FoundContract<ModularContract>;

// Encoded Compact types as emitted in the generated contract .d.ts.
export type CoinKey = { bytes: Uint8Array };
export type EncodedCoinInfo = { nonce: Uint8Array; color: Uint8Array; value: bigint };

// Local record of a coin this browser minted. The coin info returned by mint
// is the recipient's ONLY copy — wallets cannot discover contract-minted coins
// by scanning the chain (the submitting wallet is the verified exception), so
// we keep a copy in localStorage as the out-of-band record.
//
// Privacy trade-off: the nonce is stored in plaintext. It grants no spending
// authority, but anyone who reads it (XSS, malicious extension) can reconstruct
// the coin commitment and de-anonymize the mint's recipient. Demo
// simplification — encrypt at rest before real use.
export type MintedCoin = {
  nonceHex: string;
  colorHex: string;
  value: string;
  txHash: string;
  mintedAt: string;
};

export type UserAction = {
  mint: string | undefined;
  burn: string | undefined;
};

export type DerivedState = {
  readonly privateState: ModularPrivateState;
  readonly turns: UserAction;
  readonly tokenName: Modular.Ledger["ShieldedToken__name"];
  readonly tokenSymbol: Modular.Ledger["ShieldedToken__symbol"];
  readonly tokenDecimals: Modular.Ledger["ShieldedToken__decimals"];
  readonly tokenDomain: Modular.Ledger["ShieldedToken__domain"];
  // The owner commitment stored on the public ledger (hex).
  readonly ownerCommitmentHex: string | null;
  // Whether this session's passkey-derived secret hashes to the ledger owner.
  readonly isOwner: boolean;
};

export const emptyState: DerivedState = {
  privateState: emptyPrivateState(),
  turns: { mint: undefined, burn: undefined },
  tokenName: '',
  tokenSymbol: '',
  tokenDecimals: 0n,
  tokenDomain: new Uint8Array(32),
  ownerCommitmentHex: null,
  isOwner: false,
};
