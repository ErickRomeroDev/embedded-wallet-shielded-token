import path from 'path';
import * as api from '../api';
import { type ModularProviders } from '../common-types';
import { currentDir } from '../config';
import { createLogger } from '../logger';
import { TestEnvironment } from './simulators/simulator';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import 'dotenv/config';
import * as Rx from 'rxjs';
import { TOKEN_NAME, TOKEN_SYMBOL, TOKEN_DECIMALS } from '@eddalabs/contract';

// NOTE: reuses the standalone.yml docker services — cannot run concurrently
// with a live `deploy-standalone` stack (same constraint as counter.test.ts).

let logDir: string;
const network = process.env.TEST_ENV || 'undeployed';
if (network === 'undeployed') {
  logDir = path.resolve(currentDir, '..', 'logs', 'test-undeployed', `${new Date().toISOString()}.log`);
} else if (network === 'preprod') {
  logDir = path.resolve(currentDir, '..', 'logs', 'test-preprod', `${new Date().toISOString()}.log`);
} else {
  logDir = path.resolve(currentDir, '..', 'logs', 'test-preview', `${new Date().toISOString()}.log`);
}
const logger = await createLogger(logDir);

const MINT_AMOUNT = 1_000n;
const BURN_AMOUNT = 400n;

describe('Shielded token', () => {
  let testEnvironment: TestEnvironment;
  let wallet: api.WalletContext;
  let providers: ModularProviders;

  beforeAll(
    async () => {
      api.setLogger(logger);
      testEnvironment = new TestEnvironment(logger);
      const testConfiguration = await testEnvironment.start();
      logger.info(`Test configuration: ${JSON.stringify(testConfiguration)}`);
      wallet = await testEnvironment.getWallet();
      providers = await api.configureProviders(wallet, testConfiguration.dappConfig);
    },
    1000 * 60 * 45,
  );

  afterAll(async () => {
    await testEnvironment.shutdown();
  });

  it('should deploy, mint to self, observe wallet balance, and burn [@slow]', async () => {
    const contract = await api.deploy(providers, { privateCounter: 0 });
    expect(contract).not.toBeNull();
    const contractAddress = contract.deployTxData.public.contractAddress;

    // Metadata lands on the public ledger exactly as passed to the constructor.
    const tokenState = await api.getTokenState(providers, contractAddress);
    expect(tokenState).not.toBeNull();
    expect(tokenState!.name).toEqual(TOKEN_NAME);
    expect(tokenState!.symbol).toEqual(TOKEN_SYMBOL);
    expect(tokenState!.decimals).toEqual(TOKEN_DECIMALS);

    const color = api.getTokenColor(contractAddress);
    expect(color).toMatch(/^[0-9a-f]{64}$/);

    // Mint to the genesis wallet's own shielded coin public key.
    const state = await Rx.firstValueFrom(wallet.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
    const ownCoinPublicKey = state.shielded.coinPublicKey.toHexString();
    const { tx: mintTx, coin } = await api.mint(contract, ownCoinPublicKey, MINT_AMOUNT);

    expect(mintTx.txHash).toMatch(/[0-9a-f]{64}/);
    expect(mintTx.blockHeight).toBeGreaterThan(0n);
    expect(coin.value).toEqual(MINT_AMOUNT);
    expect(Buffer.from(coin.color).toString('hex')).toEqual(color);
    logger.info({ section: 'Minted coin', coin: api.coinToRecord(coin) });

    // CRITICAL CHECKPOINT (decision point 1): does the submitting wallet
    // discover its own contract-minted coin by syncing? Gates whether the
    // deploy flow can deliver tokens via a normal wallet transfer (approach A)
    // or must hand the coin info over out of band (approach B).
    const balance = await api.waitForShieldedTokenBalance(wallet, color, MINT_AMOUNT, 120_000);
    expect(balance).toBeGreaterThanOrEqual(MINT_AMOUNT);

    // Burn part of it: the wallet funds the coin during balancing; change
    // returns to our own key.
    const { tx: burnTx, change } = await api.burn(contract, contractAddress, BURN_AMOUNT, ownCoinPublicKey);
    expect(burnTx.txHash).toMatch(/[0-9a-f]{64}/);
    // Full-value coin burn (coin.value === amount) → no change expected.
    expect(change.is_some).toBe(false);

    const balanceAfterBurn = await api.getShieldedTokenBalance(wallet, color);
    logger.info({ section: 'Balance after burn', balanceAfterBurn });
    expect(balanceAfterBurn).toEqual(MINT_AMOUNT - BURN_AMOUNT);
  }, 1000 * 60 * 20);
});
