import { useCallback, useEffect, useState } from 'react';
import { classifyTxError, type ClassifiedTxError } from '../utils/classify-tx-error';

export type TxStage =
  | 'idle'
  | 'proving'
  | 'signing'
  | 'submitting'
  | 'finalizing'
  | 'indexing'
  | 'confirmed'
  | 'error';

const stageMessages: Record<TxStage, string> = {
  idle: '',
  proving: 'Generating zero-knowledge proof...',
  signing: 'Check your wallet extension — you may need to approve the transaction.',
  submitting: 'Submitting transaction to network...',
  finalizing: 'Waiting for block confirmation...',
  indexing: 'Indexing transaction...',
  confirmed: 'Transaction confirmed!',
  error: 'Transaction failed',
};

const stageProgress: Record<TxStage, number> = {
  idle: 0,
  proving: 15,
  signing: 40,
  submitting: 60,
  finalizing: 75,
  indexing: 90,
  confirmed: 100,
  error: 0,
};

// Maps the provider flow messages (ACTION_MESSAGES in modular-providers.tsx)
// to stages. All five Started events are emitted by the wrapped providers, so
// every stage here is reachable through real events.
function parseStageFromFlowMessage(message: string | undefined): TxStage | null {
  if (!message) return null;
  if (message.includes('Downloading')) return 'proving';
  if (message.includes('Proving')) return 'proving';
  if (message.includes('Signing') || message.includes('wallet')) return 'signing';
  if (message.includes('Submitting')) return 'submitting';
  if (message.includes('finalization') || message.includes('Waiting')) return 'finalizing';
  return null;
}

// If a single stage stays active this long without progressing, the proof
// server or the chain submit is almost certainly wedged. We surface
// `stalled: true` so the modal can show a hint, WITHOUT tearing down the
// in-flight call — the user may still want to wait.
const STALL_TIMEOUT_MS = 90_000;

const AUTO_DISMISS_SUCCESS_MS = 1_200;
const AUTO_DISMISS_ERROR_MS = 5_000;

export function useTransactionProgress() {
  const [stage, setStage] = useState<TxStage>('idle');
  const [error, setError] = useState<ClassifiedTxError | null>(null);
  const [stalled, setStalled] = useState(false);

  const isProcessing = !['idle', 'confirmed', 'error'].includes(stage);

  // Warn before leaving the page while a transaction is in flight.
  useEffect(() => {
    if (!isProcessing) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isProcessing]);

  // Reset the stall timer whenever the active stage changes: a transition
  // counts as progress; only sitting in one stage for STALL_TIMEOUT_MS stalls.
  useEffect(() => {
    setStalled(false);
    if (!isProcessing) return;
    const handle = setTimeout(() => setStalled(true), STALL_TIMEOUT_MS);
    return () => clearTimeout(handle);
  }, [stage, isProcessing]);

  const updateFromFlowMessage = useCallback(
    (flowMessage: string | undefined) => {
      const parsed = parseStageFromFlowMessage(flowMessage);
      if (parsed) {
        setStage((current) =>
          current !== 'idle' && current !== 'confirmed' && current !== 'error' ? parsed : current,
        );
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setStage('idle');
    setError(null);
  }, []);

  /**
   * Runs a transaction behind the progress machine. Returns the function's
   * result, or null on failure (the classified error is exposed as `error`
   * and the stage becomes 'error'). Throw user-facing Error messages from
   * preflight validation inside `fn` — 'unknown' classification passes them
   * through verbatim.
   */
  const execute = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setStage('proving');
    setError(null);
    try {
      const result = await fn();
      setStage('confirmed');
      // Auto-dismiss quickly on success so the modal doesn't keep blocking.
      setTimeout(() => setStage('idle'), AUTO_DISMISS_SUCCESS_MS);
      return result;
    } catch (e: unknown) {
      setError(classifyTxError(e));
      setStage('error');
      // Auto-idle after a grace period — the error stays visible in the
      // page's inline banner, so the modal doesn't need to be sticky.
      setTimeout(() => setStage('idle'), AUTO_DISMISS_ERROR_MS);
      return null;
    }
  }, []);

  return {
    stage,
    message: stageMessages[stage],
    progress: stageProgress[stage],
    error,
    errorMessage: error?.message ?? null,
    stalled,
    execute,
    reset,
    updateFromFlowMessage,
    isIdle: stage === 'idle',
    isProcessing,
  };
}
