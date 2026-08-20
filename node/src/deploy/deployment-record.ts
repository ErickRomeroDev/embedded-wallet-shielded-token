import fs from 'node:fs/promises';
import path from 'node:path';
import { currentDir } from '../config';

export interface DeploymentRecord {
  network: string;
  contractAddress: string;
  contractName: string;
  deployedAt: string;
  endpoints: {
    node: string;
    indexer: string;
    indexerWS: string;
    proofServer: string;
  };
  funding?: {
    address: string;
    amount: string;
    txHash?: string;
    error?: string;
  };
  tokenFunding?: {
    address: string;
    amount: string;
    color: string;
    mintTxHash?: string;
    transferTxHash?: string;
    error?: string;
  };
}

const recordPath = (network: string): string => path.resolve(currentDir, '..', 'deployments', `${network}.json`);

/**
 * Atomically write the deployment record for a network to
 * deployments/<network>.json (committed — it is the durable source of truth
 * for consuming applications like the web frontend).
 */
export async function writeDeploymentRecord(record: DeploymentRecord): Promise<string> {
  const p = recordPath(record.network);
  const tmp = `${p}.tmp`;
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf-8');
  await fs.rename(tmp, p);
  return p;
}
