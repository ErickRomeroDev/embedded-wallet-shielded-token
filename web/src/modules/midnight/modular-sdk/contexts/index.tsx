import { DeployedProvider } from './modular-deployment';
import { Provider } from './modular-providers';
import { Logger } from 'pino';
import { ContractAddress } from '@midnight-ntwrk/compact-runtime';

export * from './modular-providers';
export * from './modular-deployment';
export * from './modular-deployment-class';

interface AppProviderProps {
  children: React.ReactNode;
  logger: Logger;
  contractAddress: ContractAddress;
}

export const ModularAppProvider = ({ children, logger, contractAddress }: AppProviderProps) => {
  return (
    <Provider logger={logger}>
      <DeployedProvider logger={logger} contractAddress={contractAddress}>
        {children}
      </DeployedProvider>
    </Provider>
  );
};
