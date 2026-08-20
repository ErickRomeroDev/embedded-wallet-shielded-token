import { CombinedTokenTransfer, MidnightBech32m, UnshieldedAddress, ShieldedAddress } from '@midnightntwrk/wallet-sdk';
import { networkId } from '@midnight-ntwrk/midnight-js';
import * as api from '../../api';
import * as ledger from '@midnight-ntwrk/ledger-v8';
import { tokenValue } from './utils';


//allows to transfer unshielded tokens
//TODO: correct error with address
export async function sendUnshieldedToken(wallet: api.WalletContext, address: string, amount: bigint): Promise<string> {

  const tokenTransfer: CombinedTokenTransfer[] = [
    {
      type: 'unshielded',
      outputs: [
        {
          type: ledger.unshieldedToken().raw,
          amount: tokenValue(amount),
          receiverAddress: address as unknown as UnshieldedAddress,
        },
      ],
    },
  ];

  const recipe = await wallet.wallet.transferTransaction(
    tokenTransfer,
    { shieldedSecretKeys: wallet.shieldedSecretKeys, dustSecretKey: wallet.dustSecretKey },
    { ttl: new Date(Date.now() + 300 * 60 * 1000) },
  );

  const signedRecipe = await wallet.wallet.signRecipe(recipe, (payload) =>
    wallet.unshieldedKeystore.signData(payload),
  );

  const finalizedTx = await wallet.wallet.finalizeRecipe(signedRecipe);
  const submittedTxHash = await wallet.wallet.submitTransaction(finalizedTx);

  return submittedTxHash;
}

//transfers `amount` base units of a shielded token (by raw color hex) to a
//bech32m shielded address (mn_shield-addr_...). A normal wallet-to-wallet
//shielded transfer — the recipient's wallet detects it by scanning, unlike
//contract-minted coins.
export async function sendShieldedToken(
  wallet: api.WalletContext,
  address: string,
  tokenColorRaw: string,
  amount: bigint,
): Promise<string> {
  const addressBech32m = MidnightBech32m.parse(address);
  const shieldedAddress = ShieldedAddress.codec.decode(networkId.getNetworkId(), addressBech32m);

  const tokenTransfer: CombinedTokenTransfer[] = [
    {
      type: 'shielded',
      outputs: [
        {
          type: tokenColorRaw,
          amount,
          receiverAddress: shieldedAddress,
        },
      ],
    },
  ];

  const recipe = await wallet.wallet.transferTransaction(
    tokenTransfer,
    { shieldedSecretKeys: wallet.shieldedSecretKeys, dustSecretKey: wallet.dustSecretKey },
    { ttl: new Date(Date.now() + 30 * 60 * 1000) },
  );

  const signedRecipe = await wallet.wallet.signRecipe(recipe, (payload) =>
    wallet.unshieldedKeystore.signData(payload),
  );

  const finalizedTx = await wallet.wallet.finalizeRecipe(signedRecipe);
  const submittedTxHash = await wallet.wallet.submitTransaction(finalizedTx);

  return submittedTxHash;
}

//allows to transfer arbitrary unshielded tokens
export async function sendArbitraryUnshieldedToken(wallet: api.WalletContext, address: string, amount: bigint): Promise<string> {

  //address Hex format
  const addressBech32m = MidnightBech32m.parse(address);
  const addressHex = UnshieldedAddress.codec.decode(networkId.getNetworkId(), addressBech32m);

  const outputs = [
    {
      type: ledger.unshieldedToken().raw,
      value: tokenValue(amount),
      owner: addressHex.hexString,
    },
  ];

  const intent = ledger.Intent.new(new Date(Date.now() + 30 * 60 * 1000));
  intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([], outputs, []);

  const arbitraryTx = ledger.Transaction.fromParts(networkId.getNetworkId(), undefined, undefined, intent);

  const recipe = await wallet.wallet.balanceUnprovenTransaction(
    arbitraryTx,
    { shieldedSecretKeys: wallet.shieldedSecretKeys, dustSecretKey: wallet.dustSecretKey },
    { ttl: new Date(Date.now() + 30 * 60 * 1000) },
  );

  const signedRecipe = await wallet.wallet.signRecipe(recipe, (payload) =>
    wallet.unshieldedKeystore.signData(payload),
  );

  const finalizedTx = await wallet.wallet.finalizeRecipe(signedRecipe);
  const submittedTxHash = await wallet.wallet.submitTransaction(finalizedTx);

  return submittedTxHash;
}
