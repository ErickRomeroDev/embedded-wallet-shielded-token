export type TxErrorKind =
  | 'user-rejected'
  | 'proof-server'
  | 'insufficient-funds'
  | 'network'
  | 'unknown';

export interface ClassifiedTxError {
  kind: TxErrorKind;
  message: string;
  retryable: boolean;
}

/**
 * Maps a thrown transaction error to a user-facing message by pattern-matching
 * the raw message. Preflight validation errors thrown by page handlers are
 * already user-facing, so 'unknown' passes the original message through.
 */
export function classifyTxError(e: unknown): ClassifiedTxError {
  const raw = e instanceof Error ? e.message : String(e ?? 'Unknown error');
  const lower = raw.toLowerCase();

  if (
    lower.includes('rejected') ||
    lower.includes('declined') ||
    lower.includes('denied') ||
    lower.includes('cancelled by user') ||
    lower.includes('canceled by user') ||
    lower.includes('user abort')
  ) {
    return {
      kind: 'user-rejected',
      message: 'You declined the transaction in your wallet. No changes were made.',
      retryable: true,
    };
  }

  if (
    lower.includes('proof server') ||
    lower.includes('prover') ||
    lower.includes('proving') ||
    lower.includes('6300')
  ) {
    return {
      kind: 'proof-server',
      message:
        'The proof server could not be reached or failed to prove the transaction. Make sure it is running, then try again.',
      retryable: true,
    };
  }

  if (
    lower.includes('insufficient') ||
    lower.includes('not enough') ||
    lower.includes('balance too low') ||
    lower.includes('unable to balance')
  ) {
    return {
      kind: 'insufficient-funds',
      message:
        'Your wallet could not fund this transaction. Check your token and DUST balances, then try again.',
      retryable: false,
    };
  }

  if (
    lower.includes('fetch') ||
    lower.includes('network') ||
    lower.includes('websocket') ||
    lower.includes('timeout') ||
    lower.includes('econnrefused')
  ) {
    return {
      kind: 'network',
      message: 'A network request failed. Check your connection and the local stack, then try again.',
      retryable: true,
    };
  }

  return { kind: 'unknown', message: raw, retryable: true };
}
