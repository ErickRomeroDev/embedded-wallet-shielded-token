import 'dotenv/config';
import path from 'node:path';
import * as api from '../api';
import { emptyPrivateState } from '@eddalabs/contract';
import { currentDir, UndeployedConfig } from '../config';
import { createLogger } from '../logger';
import { sendArbitraryUnshieldedToken } from '../test/utils/wallet-transfers';
import { type DeploymentRecord, writeDeploymentRecord } from './deployment-record';
import { requireOwnerCommitment } from './owner-commitment';

// The docker stack is started detached by the deploy-standalone npm script
// (docker compose -f standalone.yml up -d --wait) and LEFT RUNNING after this
// script exits. Stop it with: pnpm standalone-down
// Note: test-undeployed reuses the same container names — run standalone-down first.
//
// Mint is owner-gated and the owner secret lives in the deployer's browser
// (passkey), so this script cannot mint MKT. Fund NIGHT/DUST here, then mint
// tokens from the web app.
const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const FUND_AMOUNT = BigInt(process.env.FUND_AMOUNT ?? '1000');

async function main(): Promise<void> {
  const logger = await createLogger(
    path.resolve(currentDir, '..', 'logs', 'deploy-standalone', `${new Date().toISOString()}.log`),
  );
  api.setLogger(logger);

  const ownerCommitment = requireOwnerCommitment();

  const config = new UndeployedConfig();
  const wallet = await api.buildWalletAndWaitForFunds(config, GENESIS_MINT_WALLET_SEED);
  try {
    const providers = await api.configureProviders(wallet, config);
    await api.waitForProofServer(config);

    const contract = await api.deploy(providers, emptyPrivateState(), ownerCommitment);
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

    console.log(`\nDeployed MintKey contract at: ${contractAddress}`);
    console.log(`Owner commitment: ${Buffer.from(ownerCommitment).toString('hex')}`);
    console.log(`Deployment record: ${recordFile}`);
    if (record.funding) {
      console.log(
        record.funding.txHash
          ? `Funded ${record.funding.address} with ${record.funding.amount} tNight`
          : `Funding FAILED: ${record.funding.error}`,
      );
    }
    console.log('Point web/.env VITE_CONTRACT_ADDRESS at the address above, then mint MKT from the web app.');
    console.log('The standalone stack keeps running. Stop it with: pnpm standalone-down\n');
  } finally {
    await api.closeWallet(wallet); // containers keep running
  }
}

main().catch((e) => {
  console.error('deploy-standalone failed:', e);
  process.exit(1);
});
