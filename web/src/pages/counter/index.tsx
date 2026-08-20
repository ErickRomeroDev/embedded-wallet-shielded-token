import { Loading } from "@/components/loading";
import { useEffect, useRef, useState } from "react";
import { RefreshCw, Hash, Activity, Lock, MapPin, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CopyHash } from "@/components/copy-hash";
import { TransactionProgressModal } from "@/components/transaction-progress-modal";
import { WalletGateButton } from "@/components/wallet-gate-button";
import { useContractSubscription } from "@/modules/midnight/modular-sdk/hooks/use-contract-subscription";
import { useTransactionProgress } from "@/modules/midnight/modular-sdk/hooks/use-transaction-progress";
import { useWallet } from "@/modules/midnight/wallet-widget/hooks/useWallet";

export const Counter = () => {
  const { deployedContractAPI, derivedState, providers } = useContractSubscription();
  const { shieldedAddresses } = useWallet();
  const txProgress = useTransactionProgress();
  const [appLoading, setAppLoading] = useState(true);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  // Snapshot of the wallet identity, so an in-flight tx can detect an account switch.
  const shieldedAddressesRef = useRef(shieldedAddresses);
  useEffect(() => {
    shieldedAddressesRef.current = shieldedAddresses;
  }, [shieldedAddresses]);

  useEffect(() => {
    if (derivedState?.round !== undefined) {
      setAppLoading(false);
    }
  }, [derivedState?.round]);

  // Bridge provider flow messages into the transaction stage machine.
  useEffect(() => {
    txProgress.updateFromFlowMessage(providers?.flowMessage);
  }, [providers?.flowMessage, txProgress]);

  const canAct = !!deployedContractAPI && !txProgress.isProcessing;

  const increment = async () => {
    if (!deployedContractAPI) return;
    const flowStartKey = shieldedAddressesRef.current?.shieldedCoinPublicKey ?? "";
    setLastTxHash(null);
    const result = await txProgress.execute(async () => {
      const liveKey = shieldedAddressesRef.current?.shieldedCoinPublicKey ?? "";
      if (liveKey !== flowStartKey) {
        throw new Error("Wallet account changed during the transaction. Please reconnect and retry.");
      }
      return deployedContractAPI.increment();
    });
    if (result !== null) {
      setLastTxHash(result.txHash);
    }
  };

  const stats = [
    {
      label: 'Counter Value',
      value: derivedState?.round || '0',
      icon: Hash,
    },
    {
      label: 'Private Data',
      value: derivedState?.privateState.privateCounter || '0',
      icon: Lock,
    },
    {
      label: 'Turn Status',
      value: derivedState?.turns.increment || 'idle',
      icon: Activity,
      mono: true,
    },
  ];

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {appLoading && <Loading />}
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-foreground mb-1">
            Counter
          </h1>
          <p className="text-muted-foreground">
            Interact with the counter module of the deployed modular contract
          </p>
        </div>

        <TransactionProgressModal
          stage={txProgress.stage}
          message={txProgress.message}
          progress={txProgress.progress}
          errorMessage={txProgress.errorMessage}
          stalled={txProgress.stalled}
          txHash={lastTxHash}
          title="Incrementing Counter"
          onDismiss={txProgress.reset}
        />

        {/* Actions */}
        <Card className="mb-6 border-border/60">
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
            <CardDescription>
              Increment the deployed counter contract
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-3">
              <WalletGateButton
                requires="signing"
                contractReady={canAct}
                busy={txProgress.isProcessing}
                idleLabel="Increment Counter"
                idleIcon={<RefreshCw className="h-4 w-4" />}
                onAction={increment}
              />
            </div>

            {txProgress.stage === "error" && txProgress.errorMessage && (
              <div className="mt-4 flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-600 dark:text-red-400">{txProgress.errorMessage}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.label} className="border-border/60">
                <CardContent className="pt-5 pb-5">
                  <div className="flex items-start gap-3">
                    <div className="flex items-center justify-center h-8 w-8 rounded-md bg-muted shrink-0">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground mb-1">{stat.label}</p>
                      <p className={`text-lg font-semibold ${stat.mono ? 'font-mono text-sm' : ''}`}>
                        {stat.value}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          <Card className="border-border/60">
            <CardContent className="pt-5 pb-5">
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center h-8 w-8 rounded-md bg-muted shrink-0">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Contract Address</p>
                  {deployedContractAPI ? (
                    <CopyHash
                      value={deployedContractAPI.deployedContractAddress}
                      label="contract address"
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">Not connected</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};
