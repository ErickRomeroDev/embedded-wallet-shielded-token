import { createRootRoute, Outlet } from '@tanstack/react-router';
import { useState } from 'react';
import * as pino from "pino";
// Registers the embedded (passkey) wallet on window.midnight. Must run before
// the wallet auto-reconnect effect polls for it — this side-effect import does that.
import "@/modules/midnight/embedded-wallet/register";
import { deriveOwnerCommitmentHex } from "@/modules/midnight/embedded-wallet";
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

// Pre-deploy bootstrap page. MintKey's deploy needs the deployer's owner
// commitment first, so this page can produce it from the passkey before any
// contract exists.
function ContractAddressError() {
  const [commitment, setCommitment] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const getCommitment = async () => {
    setBusy(true);
    setError(null);
    try {
      setCommitment(await deriveOwnerCommitmentHex());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!commitment) return;
    await navigator.clipboard.writeText(commitment);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div style={{ maxWidth: '42rem', margin: '4rem auto', padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '1rem' }}>
        MintKey — no contract configured yet
      </h1>
      <p style={{ marginBottom: '0.75rem', lineHeight: 1.6 }}>
        This app joins an already-deployed MintKey contract, but{' '}
        <code>VITE_CONTRACT_ADDRESS</code> is {contractAddress ? 'not a valid 64-character hex address' : 'not set'}.
        The deploy needs your <strong>owner commitment</strong> — the hash of a secret derived from
        your passkey. The secret never leaves this browser; only its hash goes on-chain.
      </p>
      <ol style={{ lineHeight: 1.8, paddingLeft: '1.25rem', marginBottom: '1rem' }}>
        <li>Create your owner commitment with the button below (uses your passkey)</li>
        <li>
          Set it as <code>OWNER_COMMITMENT</code> in <code>node/.env</code>
        </li>
        <li>
          Deploy from the node package: <code>pnpm deploy-standalone</code>
        </li>
        <li>
          Copy <code>contractAddress</code> from <code>node/deployments/&lt;network&gt;.json</code> into{' '}
          <code>VITE_CONTRACT_ADDRESS</code> in <code>web/.env</code> and restart Vite
        </li>
      </ol>
      <button
        onClick={getCommitment}
        disabled={busy}
        style={{
          padding: '0.5rem 1rem',
          borderRadius: '0.375rem',
          border: '1px solid #ccc',
          background: busy ? '#eee' : '#111',
          color: busy ? '#666' : '#fff',
          cursor: busy ? 'default' : 'pointer',
        }}
      >
        {busy ? 'Waiting for passkey…' : 'Create / show my owner commitment'}
      </button>
      {commitment && (
        <div style={{ marginTop: '1rem' }}>
          <p style={{ fontSize: '0.85rem', marginBottom: '0.25rem' }}>Your owner commitment:</p>
          <code style={{ display: 'block', wordBreak: 'break-all', padding: '0.5rem', background: '#f4f4f4', borderRadius: '0.375rem' }}>
            {commitment}
          </code>
          <button
            onClick={copy}
            style={{ marginTop: '0.5rem', padding: '0.25rem 0.75rem', borderRadius: '0.375rem', border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}
      {error && (
        <p style={{ marginTop: '1rem', color: '#b91c1c', lineHeight: 1.6 }}>{error}</p>
      )}
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
