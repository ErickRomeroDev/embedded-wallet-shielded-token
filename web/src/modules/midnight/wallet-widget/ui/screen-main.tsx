import { useEffect, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { useWallet } from "../hooks/useWallet";
import { walletsListFormat } from "./common/common-values";
import { TooltipProvider } from "./common/tooltip";
import WalletIcon from "./wallet-icon";

export default function ScreenMain({
  selectedNetwork,
  setOpen,
}: {
  selectedNetwork: string;
  setOpen: (value: boolean) => void;
}) {
  const { connectWallet, connectingWallet, error, status } = useWallet();
  const walletEntries = Object.values(walletsListFormat);
  const [attempting, setAttempting] = useState<string | null>(null);

  // Close the dialog only once a connection actually succeeds.
  useEffect(() => {
    if (attempting && status?.status === "connected") {
      setAttempting(null);
      setOpen(false);
    }
  }, [attempting, status, setOpen]);

  const handleConnect = (key: string) => {
    setAttempting(key);
    void connectWallet(key, selectedNetwork);
  };

  const attemptingName =
    (attempting && walletsListFormat[attempting]?.displayName) || "wallet";

  if (connectingWallet) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium">Connecting to {attemptingName}…</p>
        {attempting === "embedded" && (
          <p className="text-xs text-muted-foreground max-w-xs">
            Confirm the passkey prompt. Syncing the wallet can take a moment.
          </p>
        )}
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="py-4 space-y-4">
        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-left">
            <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
            <p className="text-xs text-red-600 dark:text-red-400">
              {error instanceof Error ? error.message : String(error)}
            </p>
          </div>
        )}

        <div
          className="grid gap-4 place-items-center gap-y-8"
          style={{
            gridTemplateColumns: `repeat(${walletEntries.length}, minmax(0, 1fr))`,
          }}
        >
          {walletEntries.map((config) => (
            <WalletIcon
              key={config.key}
              iconReactNode={config.icon}
              name={config.displayName}
              action={() => handleConnect(config.key)}
            />
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
