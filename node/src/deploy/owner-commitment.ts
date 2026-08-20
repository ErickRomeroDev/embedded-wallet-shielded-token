// The owner commitment is produced in the browser: the MintKey web app
// derives the owner secret from your passkey and shows its commitment
// (persistentHash of the secret) on the Mint page. The secret never leaves
// the browser — deploys only ever see the hash.
export const requireOwnerCommitment = (): Uint8Array => {
  const hex = process.env.OWNER_COMMITMENT?.trim();
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      'OWNER_COMMITMENT is not set (or is not 64 hex chars). ' +
        'Open the MintKey web app, create/unlock your passkey wallet, use ' +
        '"Copy owner commitment" on the Mint page, and set OWNER_COMMITMENT in node/.env.',
    );
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'));
};
