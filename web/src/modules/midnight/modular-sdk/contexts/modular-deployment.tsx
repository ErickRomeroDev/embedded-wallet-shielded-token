import type { PropsWithChildren } from 'react';
import { createContext, useMemo } from 'react';
import { type Logger } from 'pino';

import type { DeployedAPIProvider } from './modular-deployment-class';
import { DeployedTemplateManager } from './modular-deployment-class';

import { ContractAddress } from '@midnight-ntwrk/compact-runtime';
import { useProviders } from '../hooks/use-providers';

export const DeployedProviderContext = createContext<DeployedAPIProvider | undefined>(undefined);

export type DeployedProviderProps = PropsWithChildren<{
  logger: Logger;  
  contractAddress: ContractAddress;
}>;

export const DeployedProvider = ({ logger, contractAddress, children }: DeployedProviderProps) => {
  const providers = useProviders();
  const manager = useMemo(() => {
    return new DeployedTemplateManager(logger, contractAddress, providers?.providers);
  }, [logger, contractAddress, providers?.providers]);

  return (
    <DeployedProviderContext.Provider value={manager}>
      {children}
    </DeployedProviderContext.Provider>
  );
};
