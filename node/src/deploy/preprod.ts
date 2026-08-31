import 'dotenv/config';
import path from 'node:path';
import * as api from '../api';
import { currentDir, PreprodConfig } from '../config';
import { createLogger, logFileTimestamp } from '../logger';
import { emptyPrivateState } from '@eddalabs/contract';
import { type DeploymentRecord, writeDeploymentRecord } from './deployment-record';
import { requireOwnerCommitment } from './owner-commitment';

// The proof server is started detached by the deploy-preprod npm script
// (docker compose -f proof-server.yml up -d) and left running.
// Stop it with: docker compose -f proof-server.yml down
// Faucet: https://faucet.preprod.midnight.network/

async function main(): Promise<void> {
  const logger = await createLogger(
    path.resolve(currentDir, '..', 'logs', 'deploy-preprod', `${logFileTimestamp()}.log`),
  );
  api.setLogger(logger);

  const mnemonic = process.env.MY_PREPROD_MNEMONIC;
  if (!mnemonic) {
    throw new Error('MY_PREPROD_MNEMONIC is not set — add your funded preprod wallet mnemonic to node/.env');
  }

  const ownerCommitment = requireOwnerCommitment();

  const config = new PreprodConfig();
  const seed = await api.mnemonicToSeed(mnemonic);
  const wallet = await api.buildWalletAndWaitForFunds(config, seed);
  try {
    const providers = await api.configureProviders(wallet, config);
    await api.waitForProofServer(config);

    const contract = await api.deploy(providers, emptyPrivateState(), ownerCommitment);
    const contractAddress = contract.deployTxData.public.contractAddress;

    const record: DeploymentRecord = {
      network: 'preprod',
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
    const recordFile = await writeDeploymentRecord(record);

    console.log(`\nDeployed MintKey contract on preprod at: ${contractAddress}`);
    console.log(`Owner commitment: ${Buffer.from(ownerCommitment).toString('hex')}`);
    console.log(`Deployment record: ${recordFile}\n`);
  } finally {
    await api.closeWallet(wallet);
  }
}

main().catch((e) => {
  console.error('deploy-preprod failed:', e);
  process.exit(1);
});
