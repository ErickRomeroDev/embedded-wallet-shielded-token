// Single source of truth for the EDDA shielded token, shared by the contract
// deploy sites (node, tests) and the web SDK. The domain separator plus the
// contract address determine the token's color, so changing TOKEN_DOMAIN
// yields a different token type.

const DOMAIN_LABEL = "edda:shielded-token";

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
export const TOKEN_NAME = "Edda Token";
export const TOKEN_SYMBOL = "EDDA";
export const TOKEN_DECIMALS = 6n;

export const DEPLOY_ARGS = [
  TOKEN_DOMAIN,
  TOKEN_NAME,
  TOKEN_SYMBOL,
  TOKEN_DECIMALS,
] as const;
