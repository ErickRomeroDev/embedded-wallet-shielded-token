import {
  type ModularProviders,
  ModularPrivateStateId,
} from "../api/common-types";
import { type ContractAddress } from "@midnight-ntwrk/compact-runtime";
import { BehaviorSubject } from "rxjs";
import { type Logger } from "pino";
import {
  ContractController,
  ContractControllerInterface,
} from "../api/contractController";
import { getOwnerSecret } from "@/modules/midnight/embedded-wallet";

export type ContractDeployment =  
  | InProgressContractDeployment
  | DeployedContract
  | FailedContractDeployment;

export interface InProgressContractDeployment {
  readonly status: "in-progress";
  readonly address?: ContractAddress;
}

export interface DeployedContract {
  readonly status: "deployed";
  readonly api: ContractControllerInterface;
  readonly address: ContractAddress;
}

export interface FailedContractDeployment {
  readonly status: "failed";
  readonly error: Error;
  readonly address?: ContractAddress;
}

export interface ContractFollow {
  readonly observable: BehaviorSubject<ContractDeployment>;
  address?: ContractAddress;
}

export interface DeployedAPIProvider {
  readonly joinContract: () => ContractFollow;
}

export class DeployedTemplateManager implements DeployedAPIProvider {
  constructor(
    private readonly logger: Logger,
    private readonly contractAddress: ContractAddress,
    private readonly providers?: ModularProviders
  ) {}

  joinContract(): ContractFollow {
    const deployment = new BehaviorSubject<ContractDeployment>({
      status: "in-progress",
      address: this.contractAddress,
    });
    const contractFollow = {
      observable: deployment,
      address: this.contractAddress,
    };

    void this.join(deployment, this.contractAddress);

    return contractFollow;
  }

  private async join(
    deployment: BehaviorSubject<ContractDeployment>,
    contractAddress: ContractAddress
  ): Promise<void> {
    try {
      if (this.providers) {
        // Embedded passkey sessions carry the owner secret (in memory only);
        // extension-wallet sessions join read-only with the zero secret.
        const api = await ContractController.join(
          ModularPrivateStateId,
          this.providers,
          contractAddress,
          this.logger,
          getOwnerSecret()
        );

        deployment.next({
          status: "deployed",
          api,
          address: api.deployedContractAddress,
        });
      } else {
        deployment.next({
          status: "failed",
          error: new Error("Providers are not available"),
        });
      }
    } catch (error: unknown) {
      this.logger.error(error);
      deployment.next({
        status: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
}
