import * as Dialog from "@radix-ui/react-dialog";
import {
  Loader2,
  Shield,
  Pencil,
  Send,
  Clock,
  Database,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  X,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { CopyHash } from "@/components/copy-hash";
import type { TxStage } from "@/modules/midnight/modular-sdk/hooks/use-transaction-progress";

interface TransactionProgressModalProps {
  stage: TxStage;
  message: string;
  progress: number;
  errorMessage: string | null;
  /** True when the same active stage has been running long enough to suggest
   *  the proof server or network is wedged. Shows a hint but keeps the tx
   *  running — the user may still want to wait. */
  stalled?: boolean;
  /** Hash of the confirmed transaction, shown with a copy button on success. */
  txHash?: string | null;
  title?: string;
  onDismiss?: () => void;
}

interface StageInfo {
  icon: React.ReactNode;
  label: string;
  stage: TxStage;
}

const stages: StageInfo[] = [
  { icon: <Shield className="w-4 h-4" />, label: "Proving", stage: "proving" },
  { icon: <Pencil className="w-4 h-4" />, label: "Signing", stage: "signing" },
  { icon: <Send className="w-4 h-4" />, label: "Submitting", stage: "submitting" },
  { icon: <Clock className="w-4 h-4" />, label: "Finalizing", stage: "finalizing" },
  { icon: <Database className="w-4 h-4" />, label: "Indexing", stage: "indexing" },
];

function getStageIndex(stage: TxStage): number {
  return stages.findIndex((s) => s.stage === stage);
}

/**
 * Blocking transaction progress modal. Built on Radix Dialog for focus trap,
 * Escape handling, and aria labelling — but Escape and outside clicks are
 * suppressed while the transaction is in flight; only terminal states
 * (confirmed/error) can be dismissed.
 */
export function TransactionProgressModal({
  stage,
  message,
  progress,
  errorMessage,
  stalled = false,
  txHash = null,
  title = "Transaction in Progress",
  onDismiss,
}: TransactionProgressModalProps) {
  const isActive = stage !== "idle";
  const currentStageIndex = getStageIndex(stage);
  const isConfirmed = stage === "confirmed";
  const isError = stage === "error";
  const isTerminal = isConfirmed || isError;

  return (
    <Dialog.Root open={isActive} onOpenChange={(open) => !open && isTerminal && onDismiss?.()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border/60 bg-card text-card-foreground shadow-lg p-6 space-y-6"
          onEscapeKeyDown={(e) => {
            if (!isTerminal) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (!isTerminal) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (!isTerminal) e.preventDefault();
          }}
          aria-describedby={undefined}
        >
          {isTerminal && onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="absolute right-3 top-3 rounded-full p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          <div className="text-center space-y-4">
            <div className="flex justify-center">
              {isConfirmed ? (
                <CheckCircle2 className="w-12 h-12 text-emerald-500" />
              ) : isError ? (
                <XCircle className="w-12 h-12 text-red-500" />
              ) : (
                <Loader2 className="w-12 h-12 text-primary animate-spin" />
              )}
            </div>
            <Dialog.Title className="text-xl font-semibold">
              {isConfirmed ? "Transaction Complete!" : isError ? "Transaction Failed" : title}
            </Dialog.Title>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Progress</span>
              <span>{progress}%</span>
            </div>
            <Progress value={progress} />
          </div>

          <div
            className={`p-3 rounded-lg ${
              isConfirmed
                ? "bg-emerald-500/10"
                : isError
                  ? "bg-red-500/10"
                  : "bg-blue-500/10"
            }`}
          >
            <p
              className={`text-sm font-medium text-center ${
                isConfirmed
                  ? "text-emerald-600 dark:text-emerald-400"
                  : isError
                    ? "text-red-600 dark:text-red-400"
                    : "text-blue-600 dark:text-blue-400"
              }`}
            >
              {isError && errorMessage ? errorMessage : message}
            </p>
            {isConfirmed && txHash && (
              <div className="mt-2 flex items-center justify-center gap-2">
                <span className="text-xs text-muted-foreground">Tx</span>
                <CopyHash value={txHash} label="transaction hash" />
              </div>
            )}
          </div>

          <div className="grid grid-cols-5 gap-1">
            {stages.map((stageInfo, index) => {
              const isCompleted = index < currentStageIndex || isConfirmed;
              const isCurrent = index === currentStageIndex && !isConfirmed && !isError;
              return (
                <div
                  key={stageInfo.stage}
                  className={`flex flex-col items-center gap-1 p-2 rounded-lg transition-colors ${
                    isCurrent
                      ? "bg-primary/10 text-primary"
                      : isCompleted
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-muted-foreground"
                  }`}
                >
                  {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : stageInfo.icon}
                  <span className="text-xs font-medium text-center">{stageInfo.label}</span>
                </div>
              );
            })}
          </div>

          {!isTerminal && (
            <div className="flex items-center justify-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4" />
              <span className="text-sm font-medium">Please do not close this window</span>
            </div>
          )}

          {!isTerminal && stalled && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300 space-y-1">
              <p className="font-semibold">Still working — this can be normal.</p>
              <p>
                The {stage} step has been active for over 90 seconds. Burn proofs are the heaviest
                in this contract and can take several minutes, so long proving is expected. Other
                causes: proof server offline (check your local stack), a hidden wallet prompt, or
                network issues reaching the Midnight node. The transaction is still in flight —
                keep waiting; do not retry, or you may submit it twice.
              </p>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
