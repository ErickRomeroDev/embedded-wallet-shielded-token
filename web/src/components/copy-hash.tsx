import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Truncated monospace hash with click-to-copy and a transient checkmark. */
export function CopyHash({
  value,
  label,
  truncateAt = 20,
}: {
  value: string;
  label: string;
  truncateAt?: number;
}) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  const head = truncateAt >= 22 ? 12 : 10;
  const truncated = value.length > truncateAt ? `${value.slice(0, head)}…${value.slice(-8)}` : value;
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard may be unavailable */
        }
      }}
      title={`Copy ${label}`}
      className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors"
    >
      <span>{truncated}</span>
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}
