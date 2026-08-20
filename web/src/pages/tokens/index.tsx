import { Loading } from "@/components/loading";
import { useEffect, useRef, useState } from "react";
import {
  Coins,
  Flame,
  Hash,
  Tag,
  Palette,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Wallet,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CopyHash } from "@/components/copy-hash";
import { TransactionProgressModal } from "@/components/transaction-progress-modal";
import { WalletGateButton } from "@/components/wallet-gate-button";
import { useContractSubscription } from "@/modules/midnight/modular-sdk/hooks/use-contract-subscription";
import { useTransactionProgress } from "@/modules/midnight/modular-sdk/hooks/use-transaction-progress";
import { useWallet } from "@/modules/midnight/wallet-widget/hooks/useWallet";
import type { MintedCoin } from "@/modules/midnight/modular-sdk/api/common-types";

/** Converts a whole-token input to base units using the on-ledger decimals. */
function toBaseUnits(whole: string, decimals: bigint): bigint | null {
  if (!/^\d+$/.test(whole)) return null;
  const amount = BigInt(whole) * 10n ** decimals;
  if (amount <= 0n || amount > 2n ** 64n - 1n) return null; // mint amounts are Uint<64>
  return amount;
}

/** Formats a base-unit amount as a decimal token string. */
function formatUnits(amount: bigint, decimals: bigint): string {
  const d = 10n ** decimals;
  const whole = amount / d;
  const frac = amount % d;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(Number(decimals), "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

export const Tokens = () => {
  const { deployedContractAPI, derivedState, providers } = useContractSubscription();
  const { shieldedAddresses, shieldedBalances, refresh } = useWallet();
  const txProgress = useTransactionProgress();
  const [refreshingBalance, setRefreshingBalance] = useState(false);
  const [appLoading, setAppLoading] = useState(true);
  const [inputError, setInputError] = useState<string | null>(null);
  const [mintAmount, setMintAmount] = useState("100");
  const [burnAmount, setBurnAmount] = useState("100");
  const [mintedCoins, setMintedCoins] = useState<MintedCoin[]>([]);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<"mint" | "burn" | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  // Snapshot of the wallet identity, so an in-flight tx can detect an account switch.
  const shieldedAddressesRef = useRef(shieldedAddresses);
  useEffect(() => {
    shieldedAddressesRef.current = shieldedAddresses;
  }, [shieldedAddresses]);

  useEffect(() => {
    if (derivedState?.tokenName !== undefined && derivedState.tokenName !== "") {
      setAppLoading(false);
    }
  }, [derivedState?.tokenName]);

  // Bridge provider flow messages into the transaction stage machine.
  useEffect(() => {
    txProgress.updateFromFlowMessage(providers?.flowMessage);
  }, [providers?.flowMessage, txProgress]);

  useEffect(() => {
    if (deployedContractAPI) {
      setMintedCoins(deployedContractAPI.getMintedCoins());
    }
  }, [deployedContractAPI]);

  const decimals = derivedState?.tokenDecimals ?? 6n;
  const symbol = derivedState?.tokenSymbol || "EDDA";
  const canAct = !!deployedContractAPI && !txProgress.isProcessing;

  // The wallet's shielded balance for this token's color. Balances are a
  // snapshot updated on connect/refresh, so refresh after a tx (and offer a
  // manual button) to keep it current.
  const tokenColor = deployedContractAPI?.tokenColor;
  const eddaBalance = tokenColor ? (shieldedBalances?.[tokenColor] ?? 0n) : 0n;

  const refreshBalance = async () => {
    setRefreshingBalance(true);
    try {
      await refresh();
    } finally {
      setRefreshingBalance(false);
    }
  };

  const runTx = async (kind: "mint" | "burn", whole: string) => {
    if (!deployedContractAPI) return;
    const amount = toBaseUnits(whole, decimals);
    if (amount === null) {
      setInputError("Enter a positive whole-token amount within range.");
      return;
    }
    setInputError(null);
    setLastTxHash(null);
    setActiveAction(kind);
    const flowStartKey = shieldedAddressesRef.current?.shieldedCoinPublicKey ?? "";

    const result = await txProgress.execute(async () => {
      const liveKey = shieldedAddressesRef.current?.shieldedCoinPublicKey ?? "";
      if (liveKey !== flowStartKey) {
        throw new Error("Wallet account changed during the transaction. Please reconnect and retry.");
      }
      return kind === "mint"
        ? deployedContractAPI.mint(amount)
        : deployedContractAPI.burn(amount);
    });

    setActiveAction(null);
    if (result !== null) {
      setLastTxHash(result.txHash);
      setMintedCoins(deployedContractAPI.getMintedCoins());
      // Give the wallet a moment to sync the new coin, then refresh the balance.
      setTimeout(() => void refreshBalance(), 3000);
    }
  };

  const copyCoin = async (coin: MintedCoin, idx: number) => {
    await navigator.clipboard.writeText(JSON.stringify(coin, null, 2));
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1200);
  };

  const inputsLocked = txProgress.isProcessing;

  return (
    <div className="container mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {appLoading && <Loading />}
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold tracking-tight text-foreground mb-1">
            Tokens
          </h1>
          <p className="text-muted-foreground">
            Mint and burn {symbol}, the shielded token module of the deployed modular contract
          </p>
        </div>

        <TransactionProgressModal
          stage={txProgress.stage}
          message={txProgress.message}
          progress={txProgress.progress}
          errorMessage={txProgress.errorMessage}
          stalled={txProgress.stalled}
          txHash={lastTxHash}
          title={activeAction === "burn" ? `Burning ${symbol}` : `Minting ${symbol}`}
          onDismiss={txProgress.reset}
        />

        {/* Your balance */}
        <Card className="mb-6 border-border/60">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex items-center justify-center h-10 w-10 rounded-md bg-emerald-500/10 shrink-0">
                  <Wallet className="h-5 w-5 text-emerald-500" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground mb-0.5">
                    Your {symbol} balance
                  </p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {deployedContractAPI ? formatUnits(eddaBalance, decimals) : "—"}
                    <span className="ml-1.5 text-sm font-normal text-muted-foreground">{symbol}</span>
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 shrink-0"
                disabled={!deployedContractAPI || refreshingBalance}
                onClick={refreshBalance}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshingBalance ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <Card className="mb-6 border-border/60">
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
            <CardDescription>
              Mint {symbol} to your wallet, or burn {symbol} your wallet holds.
              Mint and burn are open to anyone — this is a starter template, not
              a production token.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  inputMode="numeric"
                  value={mintAmount}
                  onChange={(e) => setMintAmount(e.target.value)}
                  disabled={inputsLocked}
                  className="w-full sm:w-40 rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
                  aria-label={`Amount of ${symbol} to mint`}
                />
                <WalletGateButton
                  requires="signing"
                  contractReady={canAct}
                  busy={txProgress.isProcessing && activeAction === "mint"}
                  disabled={inputsLocked}
                  idleLabel={`Mint ${symbol}`}
                  idleIcon={<Coins className="h-4 w-4" />}
                  onAction={() => runTx("mint", mintAmount)}
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  inputMode="numeric"
                  value={burnAmount}
                  onChange={(e) => setBurnAmount(e.target.value)}
                  disabled={inputsLocked}
                  className="w-full sm:w-40 rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
                  aria-label={`Amount of ${symbol} to burn`}
                />
                <WalletGateButton
                  requires="signing"
                  contractReady={canAct}
                  busy={txProgress.isProcessing && activeAction === "burn"}
                  disabled={inputsLocked}
                  idleLabel={`Burn ${symbol}`}
                  idleIcon={<Flame className="h-4 w-4" />}
                  onAction={() => runTx("burn", burnAmount)}
                />
              </div>
            </div>

            {inputError && (
              <div className="mt-4 flex items-start gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <p className="text-sm text-amber-700 dark:text-amber-400">{inputError}</p>
              </div>
            )}

            {txProgress.stage === "error" && txProgress.errorMessage && (
              <div className="mt-4 flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-600 dark:text-red-400">
                  {txProgress.errorMessage}
                  {txProgress.error?.kind === "insufficient-funds" &&
                    ` Make sure your wallet holds enough ${symbol} to burn.`}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <Card className="border-border/60">
            <CardContent className="pt-5 pb-5">
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center h-8 w-8 rounded-md bg-muted shrink-0">
                  <Tag className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Name</p>
                  <p className="text-lg font-semibold">{derivedState?.tokenName || "—"}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/60">
            <CardContent className="pt-5 pb-5">
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center h-8 w-8 rounded-md bg-muted shrink-0">
                  <Coins className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Symbol · Decimals</p>
                  <p className="text-lg font-semibold">
                    {symbol} · <span className="inline-flex items-center gap-1"><Hash className="h-3.5 w-3.5" />{decimals.toString()}</span>
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/60">
            <CardContent className="pt-5 pb-5">
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center h-8 w-8 rounded-md bg-muted shrink-0">
                  <Palette className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Token Color</p>
                  {deployedContractAPI ? (
                    <CopyHash value={deployedContractAPI.tokenColor} label="token color" />
                  ) : (
                    <p className="text-sm text-muted-foreground">Not connected</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
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

        {/* Minted coins registry */}
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-base">Minted coins (local record)</CardTitle>
            <CardDescription>
              Coins minted from this browser. The coin info returned by a mint
              is its only copy — it is kept here (localStorage) as an
              out-of-band record.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mintedCoins.length === 0 ? (
              <p className="text-sm text-muted-foreground">No coins minted from this browser yet.</p>
            ) : (
              <ul className="space-y-2">
                {mintedCoins.map((coin, idx) => (
                  <li
                    key={`${coin.txHash}-${idx}`}
                    className="flex items-center justify-between gap-3 p-2 rounded-lg border border-border/40"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {(BigInt(coin.value) / 10n ** decimals).toString()} {symbol}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CopyHash value={coin.txHash} label="mint transaction hash" />
                        <span>{new Date(coin.mintedAt).toLocaleString()}</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 shrink-0"
                      onClick={() => copyCoin(coin, idx)}
                    >
                      {copiedIdx === idx ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copiedIdx === idx ? "Copied" : "Copy JSON"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
