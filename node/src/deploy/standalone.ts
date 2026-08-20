import 'dotenv/config';
import path from 'node:path';
import * as Rx from 'rxjs';
import * as api from '../api';
import { currentDir, UndeployedConfig } from '../config';
import { createLogger } from '../logger';
import { sendArbitraryUnshieldedToken, sendShieldedToken } from '../test/utils/wallet-transfers';
import { tokenValue } from '../test/utils/utils';
import { type DeploymentRecord, writeDeploymentRecord } from './deployment-record';

// The docker stack is started detached by the deploy-standalone npm script
// (docker compose -f standalone.yml up -d --wait) and LEFT RUNNING after this
// script exits. Stop it with: pnpm standalone-down
// Note: test-undeployed reuses the same container names — run standalone-down first.
const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const FUND_AMOUNT = BigInt(process.env.FUND_AMOUNT ?? '1000');
// Whole EDDA tokens; scaled by 10^6 (TOKEN_DECIMALS) into base units when minting.
const TOKEN_FUND_AMOUNT = BigInt(process.env.TOKEN_FUND_AMOUNT ?? '1000');

async function main(): Promise<void> {
  const logger = await createLogger(
    path.resolve(currentDir, '..', 'logs', 'deploy-standalone', `${new Date().toISOString()}.log`),
  );
  api.setLogger(logger);

  const config = new UndeployedConfig();
  const wallet = await api.buildWalletAndWaitForFunds(config, GENESIS_MINT_WALLET_SEED);
  try {
    const providers = await api.configureProviders(wallet, config);
    await api.waitForProofServer(config);

    const contract = await api.deploy(providers, { privateCounter: 0 });
    const contractAddress = contract.deployTxData.public.contractAddress;

    // Persist the address immediately — a later funding failure must not lose it.
    const record: DeploymentRecord = {
      network: 'undeployed',
      contractAddress,
      contractName: 'modular',
      deployedAt: new Date().toISOString(),
      endpoints: {
        node: config.node,
        indexer: config.indexer,
        indexerWS: config.indexerWS,
        proofServer: config.proofServer,
      },
    };
    let recordFile = await writeDeploymentRecord(record);

    const fundTo = process.env.MY_UNDEPLOYED_UNSHIELDED_ADDRESS;
    if (fundTo) {
      record.funding = { address: fundTo, amount: FUND_AMOUNT.toString() };
      try {
        record.funding.txHash = await sendArbitraryUnshieldedToken(wallet, fundTo, FUND_AMOUNT);
        logger.info(`Funded ${fundTo} with ${FUND_AMOUNT} tNight (tx ${record.funding.txHash})`);
      } catch (e) {
        record.funding.error = e instanceof Error ? e.message : String(e);
        logger.error(`Funding failed (non-fatal): ${record.funding.error}`);
      }
      recordFile = await writeDeploymentRecord(record);
    }

    // Shielded EDDA funding: mint to the genesis wallet itself (the submitting
    // wallet detects its own contract-minted coins — execution-verified in
    // shielded-token.test.ts), then deliver via a normal wallet-to-wallet
    // shielded transfer, which the user's wallet detects by scanning.
    const shieldedFundTo = process.env.MY_UNDEPLOYED_SHIELDED_ADDRESS;
    if (shieldedFundTo) {
      const color = api.getTokenColor(contractAddress);
      const baseUnits = tokenValue(TOKEN_FUND_AMOUNT);
      record.tokenFunding = { address: shieldedFundTo, amount: baseUnits.toString(), color };
      try {
        const state = await Rx.firstValueFrom(
          wallet.wallet.state().pipe(Rx.filter((s) => s.isSynced)),
        );
        const ownCoinPublicKey = state.shielded.coinPublicKey.toHexString();

        const { tx: mintTx } = await api.mint(contract, ownCoinPublicKey, baseUnits);
        record.tokenFunding.mintTxHash = mintTx.txHash;

        await api.waitForShieldedTokenBalance(wallet, color, baseUnits);

        record.tokenFunding.transferTxHash = await sendShieldedToken(wallet, shieldedFundTo, color, baseUnits);
        logger.info(
          `Funded ${shieldedFundTo} with ${TOKEN_FUND_AMOUNT} EDDA (mint ${record.tokenFunding.mintTxHash}, transfer ${record.tokenFunding.transferTxHash})`,
        );
      } catch (e) {
        record.tokenFunding.error = e instanceof Error ? e.message : String(e);
        logger.error(`Token funding failed (non-fatal): ${record.tokenFunding.error}`);
      }
      recordFile = await writeDeploymentRecord(record);
    }

    console.log(`\nDeployed modular contract at: ${contractAddress}`);
    console.log(`Deployment record: ${recordFile}`);
    if (record.funding) {
      console.log(
        record.funding.txHash
          ? `Funded ${record.funding.address} with ${record.funding.amount} tNight`
          : `Funding FAILED: ${record.funding.error}`,
      );
    }
    if (record.tokenFunding) {
      console.log(
        record.tokenFunding.transferTxHash
          ? `Funded ${record.tokenFunding.address} with ${TOKEN_FUND_AMOUNT} EDDA`
          : `Token funding FAILED: ${record.tokenFunding.error}`,
      );
    }
    console.log('The standalone stack keeps running. Stop it with: pnpm standalone-down\n');
  } finally {
    await api.closeWallet(wallet); // containers keep running
  }
}

main().catch((e) => {
  console.error('deploy-standalone failed:', e);
  process.exit(1);
});
