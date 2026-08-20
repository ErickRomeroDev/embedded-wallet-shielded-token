import { useEffect, useState } from "react";
import {
  KeyRound,
  Copy,
  Check,
  Eye,
  Lock,
  Trash2,
  AlertTriangle,
  Zap,
  RefreshCw,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/modules/midnight/wallet-widget/hooks/useWallet";
import {
  getEmbeddedSessionInfo,
  revealSeed,
  lockEmbeddedWallet,
  forgetEmbeddedCredential,
} from "../register";

interface SyncStatus {
  isSynced: boolean;
  connected: boolean;
  percent: number | null;
}

// Derive a display-friendly sync status from the live FacadeState. The progress
// fields are wallet/transaction indices (not block heights), so the percentage
// is an "applied vs highest" ratio — a fine progress hint. Typed loosely since
// EmbeddedSession.latestState is `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deriveSync(state: any): SyncStatus {
  const sp = state?.shielded?.progress;
  const up = state?.unshielded?.progress;
  const dp = state?.dust?.progress;
  const connected =
    (sp?.isConnected ?? true) && (up?.isConnected ?? true) && (dp?.isConnected ?? true);

  let percent: number | null = null;
  const applied = sp?.appliedIndex;
  const highest = sp?.highestIndex;
  if (typeof applied === "bigint" && typeof highest === "bigint" && highest > 0n) {
    percent = Math.max(0, Math.min(100, Math.round((Number(applied) * 100) / Number(highest))));
  }

  return { isSynced: !!state?.isSynced, connected, percent };
}

/**
 * Dashboard card for the embedded (passkey) wallet. Rendered on /wallet-ui only
 * when the active connection is the embedded wallet. Everything else on that
 * page (addresses, balances, endpoints) already works through the shared
 * wallet context.
 */
export function EmbeddedWalletCard() {
  const { disconnect, refresh } = useWallet();
  const info = getEmbeddedSessionInfo();
  const session = info.session;
  const [seed, setSeed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [resyncing, setResyncing] = useState(false);
  const [sync, setSync] = useState<SyncStatus | null>(null);

  // Never leave the seed in memory when the card unmounts.
  useEffect(() => () => setSeed(null), []);

  // Live sync status from the wallet facade's state stream.
  useEffect(() => {
    if (!session) {
      setSync(null);
      return;
    }
    const subscription = session.wallet.state().subscribe((state) => {
      setSync(deriveSync(state));
    });
    return () => subscription.unsubscribe();
  }, [session]);

  const handleResync = async () => {
    setResyncing(true);
    try {
      await refresh();
    } finally {
      setResyncing(false);
    }
  };

  const handleReveal = async () => {
    setError(null);
    setBusy(true);
    try {
      setSeed(await revealSeed());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleLock = async () => {
    setSeed(null);
    await lockEmbeddedWallet();
    disconnect();
  };

  const handleForget = async () => {
    setSeed(null);
    await forgetEmbeddedCredential();
    disconnect();
  };

  const handleRegisterDust = async () => {
    if (!info.session) return;
    setRegistering(true);
    setError(null);
    try {
      await info.session.registerDustIfNeeded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRegistering(false);
    }
  };

  const copySeed = async () => {
    if (!seed) return;
    await navigator.clipboard.writeText(seed);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-4 w-4 text-emerald-500" />
          Embedded Wallet
        </CardTitle>
        <CardDescription>
          Passkey-derived wallet — your seed is computed from this device&rsquo;s passkey.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm">
          <span className="text-muted-foreground">Passkey: </span>
          <span className="font-medium">{info.label ?? "—"}</span>
          {info.createdAt && (
            <span className="text-muted-foreground">
              {" "}
              · created {new Date(info.createdAt).toLocaleDateString()}
            </span>
          )}
        </div>

        {/* Sync status */}
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/40 px-3 py-2">
          <div className="flex items-center gap-2 text-sm">
            {!session || !sync ? (
              <span className="text-muted-foreground">Wallet status: —</span>
            ) : sync.isSynced ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                <span className="font-medium text-emerald-600 dark:text-emerald-400">Synced</span>
              </>
            ) : (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                <span className="font-medium text-amber-600 dark:text-amber-400">
                  Syncing{sync.percent !== null ? ` — ${sync.percent}%` : "…"}
                  {!sync.connected ? " · reconnecting" : ""}
                </span>
              </>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 shrink-0"
            disabled={resyncing || !session}
            title="Re-read the wallet's state and balances"
            onClick={handleResync}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${resyncing ? "animate-spin" : ""}`} />
            {resyncing ? "Resyncing…" : "Resync"}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" disabled={busy} onClick={handleReveal}>
            <Eye className="h-3.5 w-3.5" />
            {busy ? "Confirm passkey…" : "Reveal seed (backup)"}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleLock}>
            <Lock className="h-3.5 w-3.5" />
            Lock
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-red-500/40 text-red-600 dark:text-red-400"
            onClick={handleForget}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Forget passkey record
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={registering || !info.session}
            onClick={handleRegisterDust}
          >
            <Zap className="h-3.5 w-3.5" />
            {registering ? "Registering…" : "Register for DUST"}
          </Button>
        </div>

        {registering && (
          <p className="text-xs text-muted-foreground">
            Waiting for your NIGHT to generate enough DUST to cover the registration
            fee, then submitting. This can take a few minutes — keep this page open.
          </p>
        )}

        {error && (
          <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        {seed && (
          <div className="space-y-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                This is your wallet seed. Anyone who has it controls the wallet. It is your only
                recovery path if you lose this passkey — write it down and store it somewhere safe,
                never share it, and close this panel when done.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono break-all bg-background/60 rounded px-2 py-1.5">
                {seed}
              </code>
              <Button variant="ghost" size="sm" className="gap-1 shrink-0" onClick={copySeed}>
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={() => setSeed(null)}>
              Hide seed
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
