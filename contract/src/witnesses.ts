import type { WitnessContext } from "@midnight-ntwrk/compact-runtime";
import type { Ledger } from "./managed/modular/contract/index.js";

// The only private state: the Ownable secret key. Its hash is the on-chain
// owner commitment; whoever holds the preimage is the token authority.
export type ModularPrivateState = {
  ownableSecretKey: Uint8Array;
};

export const createPrivateState = (
  ownableSecretKey: Uint8Array
): ModularPrivateState => {
  if (ownableSecretKey.length !== 32) {
    throw new Error(
      `createPrivateState: expected 32-byte secret key, received ${ownableSecretKey.length} bytes`
    );
  }
  return { ownableSecretKey: Uint8Array.from(ownableSecretKey) };
};

// Non-owner sessions (extension wallets, read-only joins) use the zero
// secret: reads work normally, owner-gated circuits fail on-chain.
export const emptyPrivateState = (): ModularPrivateState => ({
  ownableSecretKey: new Uint8Array(32)
});

export const witnesses = {
  wit_OwnableSK: ({
    privateState
  }: WitnessContext<Ledger, ModularPrivateState>): [
    ModularPrivateState,
    Uint8Array
  ] => [privateState, Uint8Array.from(privateState.ownableSecretKey)]
};
