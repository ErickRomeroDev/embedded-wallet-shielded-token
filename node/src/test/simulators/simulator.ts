import { type Config, UndeployedConfig, currentDir, PreviewConfig, PreprodConfig } from '../../config';
import {
  DockerComposeEnvironment,
  GenericContainer,
  type StartedDockerComposeEnvironment,
  type StartedTestContainer,
  Wait,
} from 'testcontainers';
import path from 'path';
import * as api from '../../api';
import type { WalletContext } from '../../api';
import type { Logger } from 'pino';

const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';

// Keep in step with the proof-server image in standalone.yml / proof-server.yml.
const PROOF_SERVER_IMAGE = 'midnightntwrk/proof-server:8.0.3';

// A first-ever run pulls ~1.5 GB of images inside this window; the default 60s
// is not enough on a clean machine or a slow link.
const CONTAINER_STARTUP_TIMEOUT_MS = 10 * 60 * 1000;

// Test mnemonic - DO NOT use in production
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

export interface TestConfiguration {
  seed: string;
  mnemonic: string;
  entrypoint: string;
  dappConfig: Config;
  psMode: string;
  cacheFileName: string;
}

export class LocalTestConfig implements TestConfiguration {
  seed = GENESIS_MINT_WALLET_SEED;
  mnemonic = TEST_MNEMONIC;
  entrypoint = 'dist/standalone.js';
  psMode = 'undeployed';
  cacheFileName = '';
  dappConfig = new UndeployedConfig();
}

export function parseArgs(required: string[]): TestConfiguration {
  let entry = '';
  if (required.includes('entry')) {
    if (process.env.TEST_ENTRYPOINT !== undefined) {
      entry = process.env.TEST_ENTRYPOINT;
    } else {
      throw new Error('TEST_ENTRYPOINT environment variable is not defined.');
    }
  }

  let seed = '';
  let mnemonic = TEST_MNEMONIC;
  if (required.includes('seed')) {
    if (process.env.TEST_WALLET_SEED !== undefined) {
      seed = process.env.TEST_WALLET_SEED;
    } else {
      throw new Error('TEST_WALLET_SEED environment variable is not defined.');
    }
  }

  if (process.env.MY_PREVIEW_MNEMONIC !== undefined) {
    mnemonic = process.env.MY_PREVIEW_MNEMONIC;
  }

  let cfg: Config = new PreviewConfig();
  let env = '';
  let psMode = 'undeployed';
  let cacheFileName = '';
  if (required.includes('env')) {
    if (process.env.TEST_ENV !== undefined) {
      env = process.env.TEST_ENV;
    } else {
      throw new Error('TEST_ENV environment variable is not defined.');
    }
    switch (env) {
      case 'preview':
        cfg = new PreviewConfig();
        psMode = 'preview';
        cacheFileName = `${seed.substring(0, 7)}-${psMode}.state`;
        break;
        case 'preprod':
        cfg = new PreprodConfig();
        psMode = 'preprod';
        cacheFileName = `${seed.substring(0, 7)}-${psMode}.state`;
        break;
      default:
        throw new Error(`Unknown env value=${env}`);
    }
  }

  return {
    seed,
    mnemonic,
    entrypoint: entry,
    dappConfig: cfg,
    psMode,
    cacheFileName,
  };
}

export class TestEnvironment {
  private readonly logger: Logger;
  private env: StartedDockerComposeEnvironment | undefined;
  private dockerEnv: DockerComposeEnvironment | undefined;
  private container: StartedTestContainer | undefined;
  private walletContext: WalletContext | undefined;
  private testConfig: TestConfiguration;

  constructor(logger: Logger) {
    this.logger = logger;
    this.testConfig = new LocalTestConfig();
  }

  start = async (): Promise<TestConfiguration> => {
    if (process.env.RUN_ENV_TESTS === 'true') {
      this.testConfig = parseArgs(['env']);
      this.logger.info(`Test wallet seed: ${this.testConfig.seed}`);
      this.logger.info('Proof server starting...');
      this.container = await TestEnvironment.getProofServerContainer(this.testConfig.psMode);
      this.testConfig.dappConfig = {
        ...this.testConfig.dappConfig,
        proofServer: `http://${this.container.getHost()}:${this.container.getMappedPort(6300).toString()}`,
      };
    } else {
      this.testConfig = new LocalTestConfig();
      this.logger.info('Test containers starting...');
      const composeFile = process.env.COMPOSE_FILE ?? 'standalone.yml';
      this.logger.info(`Using compose file: ${composeFile}`);
      // Wait strategies: the node and indexer are gated on their compose
      // healthchecks, which survive image bumps. The proof-server image is
      // distroless (no shell for a healthcheck), so it keeps a log match — the
      // one place a version bump can still require a string update.
      // Cold runs pull ~1.5 GB, so the startup timeout is generous.
      this.dockerEnv = new DockerComposeEnvironment(path.resolve(currentDir, '..'), composeFile)
        .withStartupTimeout(CONTAINER_STARTUP_TIMEOUT_MS)
        .withWaitStrategy(
          'modular-proof-server',
          Wait.forLogMessage('Actix runtime found; starting in Actix runtime', 1),
        )
        .withWaitStrategy('modular-node', Wait.forHealthCheck())
        .withWaitStrategy('modular-indexer', Wait.forHealthCheck());
      this.env = await this.dockerEnv.up();

      this.testConfig.dappConfig = {
        ...this.testConfig.dappConfig,
        indexer: TestEnvironment.mapContainerPort(this.env, this.testConfig.dappConfig.indexer, 'modular-indexer'),
        indexerWS: TestEnvironment.mapContainerPort(this.env, this.testConfig.dappConfig.indexerWS, 'modular-indexer'),
        node: TestEnvironment.mapContainerPort(this.env, this.testConfig.dappConfig.node, 'modular-node'),
        proofServer: TestEnvironment.mapContainerPort(
          this.env,
          this.testConfig.dappConfig.proofServer,
          'modular-proof-server',
        ),
      };
    }
    this.logger.info(`Configuration:${JSON.stringify(this.testConfig)}`);
    this.logger.info('Test containers started');
    return this.testConfig;
  };

  /**
   * Rewrites both the host AND the port of a config URL to what the container
   * is actually reachable at.
   *
   * Rewriting only the port leaves the hardcoded 127.0.0.1 from config.ts in
   * place, which is wrong for any non-local Docker engine (Colima, Rancher
   * Desktop, OrbStack, a remote DOCKER_HOST). The wallet then dials a host
   * nothing is listening on, never reports itself connected, and the run looks
   * like an indefinite sync stall while `docker logs` shows a healthy chain.
   */
  static mapContainerPort = (env: StartedDockerComposeEnvironment, url: string, containerName: string) => {
    const mappedUrl = new URL(url);
    const container = env.getContainer(containerName);

    mappedUrl.hostname = container.getHost();
    mappedUrl.port = String(container.getFirstMappedPort());

    return mappedUrl.toString().replace(/\/+$/, '');
  };

  static getProofServerContainer = async (_env: string) =>
    await new GenericContainer(PROOF_SERVER_IMAGE)
      .withExposedPorts(6300)
      .withCommand(['midnight-proof-server -v'])
      .withEnvironment({ RUST_BACKTRACE: 'full' })
      .withWaitStrategy(Wait.forLogMessage('Actix runtime found; starting in Actix runtime', 1))
      .withStartupTimeout(CONTAINER_STARTUP_TIMEOUT_MS)
      .start();

  shutdown = async () => {
    if (this.walletContext !== undefined) {
      await api.closeWallet(this.walletContext);
    }
    if (this.env !== undefined) {
      this.logger.info('Test containers closing');
      await this.env.down();
    }
    if (this.container !== undefined) {
      this.logger.info('Test container closing');
      await this.container.stop();
    }
  };

  getWallet = async (): Promise<WalletContext> => {
    this.logger.info('Setting up wallet');

    // Use hex seed for standalone (genesis wallet), mnemonic for preview/preprod
    if (this.testConfig.psMode === 'undeployed') {
      this.walletContext = await api.buildWalletAndWaitForFunds(this.testConfig.dappConfig, this.testConfig.seed);
    } else {
      const seed = await api.mnemonicToSeed(this.testConfig.mnemonic);
      this.walletContext = await api.buildWalletAndWaitForFunds(this.testConfig.dappConfig, seed);
    }

    return this.walletContext;
  };
}
