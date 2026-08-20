// Single source of truth for the MintKey shielded token (MKT), shared by the
// contract deploy sites (node, tests) and the web SDK. The domain separator
// plus the contract address determine the token's color, so changing
// TOKEN_DOMAIN yields a different token type.

const DOMAIN_LABEL = "mintkey:shielded-token";

const encodeDomain = (label: string): Uint8Array => {
  const bytes = new TextEncoder().encode(label);
  if (bytes.length > 32) {
    throw new Error(`domain label exceeds 32 bytes: ${label}`);
  }
  const padded = new Uint8Array(32);
  padded.set(bytes);
  return padded;
};

export const TOKEN_DOMAIN: Uint8Array = encodeDomain(DOMAIN_LABEL);
export const TOKEN_NAME = "MintKey Token";
export const TOKEN_SYMBOL = "MKT";
export const TOKEN_DECIMALS = 6n;

// The owner commitment is per-deployment (it comes from the deployer's
// passkey-derived secret), so deploy args are built, not a constant.
export const makeDeployArgs = (ownerCommitment: Uint8Array) => {
  if (ownerCommitment.length !== 32) {
    throw new Error(
      `makeDeployArgs: expected 32-byte owner commitment, received ${ownerCommitment.length} bytes`
    );
  }
  return [
    ownerCommitment,
    TOKEN_DOMAIN,
    TOKEN_NAME,
    TOKEN_SYMBOL,
    TOKEN_DECIMALS
  ] as const;
};
