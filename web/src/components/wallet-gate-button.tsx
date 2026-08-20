import { type ReactNode } from "react";
import { Loader2, Wallet, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/modules/midnight/wallet-widget/hooks/useWallet";

interface WalletGateButtonProps {
  /**
   * "signing" — needs the wallet connected, the contract joined, and the proof
   * server online (mint, burn).
   * "pubkey" — only needs the wallet connected for its public key.
   */
  requires: "signing" | "pubkey";
  /** For "signing": deployedContractAPI present and not mid-flight. */
  contractReady?: boolean;
  /** This action is currently running. */
  busy?: boolean;
  /** Other app-level gating (e.g. invalid amount input). */
  disabled?: boolean;
  idleLabel: ReactNode;
  idleIcon?: ReactNode;
  variant?: "default" | "outline" | "destructive" | "secondary" | "ghost";
  size?: "sm" | "default" | "lg";
  className?: string;
  onAction: () => void | Promise<void>;
}

/**
 * Just-in-time wallet gate for a single action. Instead of walling the page,
 * the action button itself reflects what's missing and walks the user through
 * it: connect → prepare → (proof server) → run. Connecting only connects the
 * wallet; once it's ready the button shows the action and the user clicks it
 * again to run — no auto-continue.
 */
export function WalletGateButton({
  requires,
  contractReady,
  busy = false,
  disabled = false,
  idleLabel,
  idleIcon,
  variant = "outline",
  size = "default",
  className,
  onAction,
}: WalletGateButtonProps) {
  const { connectingWallet, shieldedAddresses, proofServerOnline, setOpen, recheckProofServer } =
    useWallet();

  const connected = !!shieldedAddresses?.shieldedCoinPublicKey;
  const needsContract = requires === "signing";
  const preparing = connected && (connectingWallet || (needsContract && !contractReady));
  const proofOffline = connected && needsContract && !preparing && proofServerOnline === false;

  if (!connected) {
    return (
      <Button
        size={size}
        variant={variant}
        className={`gap-1.5 ${className ?? ""}`}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Wallet className="w-4 h-4" />
        Connect wallet
      </Button>
    );
  }

  if (preparing) {
    return (
      <Button size={size} variant={variant} className={`gap-1.5 ${className ?? ""}`} disabled>
        <Loader2 className="w-4 h-4 animate-spin" />
        Preparing wallet…
      </Button>
    );
  }

  if (proofOffline) {
    return (
      <Button
        size={size}
        variant="outline"
        className={`gap-1.5 border-amber-500/40 text-amber-700 dark:text-amber-400 ${className ?? ""}`}
        title="The proof server is needed to sign this transaction. Start the standalone stack, then check again."
        onClick={() => void recheckProofServer()}
      >
        <AlertTriangle className="w-4 h-4" />
        Proof server offline — check again
      </Button>
    );
  }

  return (
    <Button
      size={size}
      variant={variant}
      className={`gap-1.5 ${className ?? ""}`}
      disabled={disabled || busy}
      onClick={() => void onAction()}
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : idleIcon}
      {idleLabel}
    </Button>
  );
}
