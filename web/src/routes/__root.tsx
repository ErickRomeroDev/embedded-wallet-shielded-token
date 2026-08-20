import { createRootRoute, Outlet } from '@tanstack/react-router';
import * as pino from "pino";
// Registers the embedded (passkey) wallet on window.midnight. Must run before
// the wallet auto-reconnect effect polls for it — this side-effect import does that.
import "@/modules/midnight/embedded-wallet/register";
import { ThemeProvider } from "@/components/theme-provider";
import { MidnightMeshProvider } from "@/modules/midnight/wallet-widget/contexts/wallet";
import { ModularAppProvider } from "@/modules/midnight/modular-sdk/contexts";
import { MainLayout } from "@/layouts/layout";

export const logger = pino.pino({
  level: "trace",
});

// The deployed contract address to join. Deployment happens in the node
// package (pnpm deploy-standalone) — copy the address from
// node/deployments/<network>.json into web/.env.
const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS;
const isValidAddress = typeof contractAddress === 'string' && /^[0-9a-fA-F]{64}$/.test(contractAddress);

export const Route = createRootRoute({
  component: RootComponent,
});

function ContractAddressError() {
  return (
    <div style={{ maxWidth: '42rem', margin: '4rem auto', padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem' }}>
        Contract address not configured
      </h1>
      <p style={{ marginBottom: '0.75rem', lineHeight: 1.6 }}>
        This app joins an already-deployed counter contract, but{' '}
        <code>VITE_CONTRACT_ADDRESS</code> is {contractAddress ? 'not a valid 64-character hex address' : 'not set'}.
      </p>
      <ol style={{ lineHeight: 1.8, paddingLeft: '1.25rem' }}>
        <li>
          Deploy the contract from the node package: <code>pnpm deploy-standalone</code>
        </li>
        <li>
          Copy <code>contractAddress</code> from <code>node/deployments/&lt;network&gt;.json</code>
        </li>
        <li>
          Set <code>VITE_CONTRACT_ADDRESS</code> in <code>web/.env</code> and restart Vite
        </li>
      </ol>
    </div>
  );
}

function RootComponent() {
  if (!isValidAddress) {
    return <ContractAddressError />;
  }
  return (
    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
      <MidnightMeshProvider logger={logger}>
        <ModularAppProvider logger={logger} contractAddress={contractAddress}>
          <MainLayout>
            <Outlet />
          </MainLayout>
        </ModularAppProvider>
      </MidnightMeshProvider>
    </ThemeProvider>
  );
}
