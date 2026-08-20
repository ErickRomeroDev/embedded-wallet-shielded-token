
import { DerivedState } from "../api/common-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { ContractControllerInterface } from "../api/contractController";
import { Observable } from "rxjs";
import { useWallet } from "../../wallet-widget/hooks/useWallet";
import { ContractDeployment } from "../contexts";
import { useDeployedContracts } from "./use-deployment";
import { useProviders } from "./use-providers";

export const useContractSubscription = () => {
  const { connectedAPI } = useWallet();
  const providers = useProviders();
  const deploy = useDeployedContracts();

  const [modularDeploymentObservable, setModularDeploymentObservable] =
    useState<Observable<ContractDeployment> | undefined>(undefined);

  const [contractDeployment, setContractDeployment] =
    useState<ContractDeployment>();
  const [deployedContractAPI, setDeployedContractAPI] =
    useState<ContractControllerInterface>();
  const [derivedState, setDerivedState] = useState<DerivedState>();
  const joinedWithRef = useRef<unknown>(null);

  const onJoin = useCallback(async (): Promise<void> => {
    setModularDeploymentObservable(deploy.joinContract().observable);
  }, [deploy, setModularDeploymentObservable]);

  useEffect(() => {
    if (connectedAPI && providers) {
      if (joinedWithRef.current !== connectedAPI) {
        setDeployedContractAPI(undefined);
        setDerivedState(undefined);
        setContractDeployment(undefined);
        setModularDeploymentObservable(undefined);
        joinedWithRef.current = connectedAPI;
      }
      void onJoin();
    } else {
      joinedWithRef.current = null;
      setDeployedContractAPI(undefined);
      setDerivedState(undefined);
      setContractDeployment(undefined);
      setModularDeploymentObservable(undefined);
    }
  }, [connectedAPI, providers, onJoin]);

  useEffect(() => {
    if (!modularDeploymentObservable) {
      return;
    }
    const subscription = modularDeploymentObservable.subscribe(
      setContractDeployment
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [modularDeploymentObservable]);

  useEffect(() => {
    if (!contractDeployment) {
      return;
    }

    if (
      contractDeployment.status === "in-progress" ||
      contractDeployment.status === "failed"
    ) {
      return;
    }
    setDeployedContractAPI(contractDeployment.api);
  }, [contractDeployment, setDeployedContractAPI]);

  useEffect(() => {
    if (deployedContractAPI) {
      const subscriptionDerivedState =
        deployedContractAPI.state$.subscribe(setDerivedState);
      return () => {
        subscriptionDerivedState.unsubscribe();
      };
    }
  }, [deployedContractAPI]);

  return {
    deployedContractAPI,
    derivedState,
    providers
  };
};
