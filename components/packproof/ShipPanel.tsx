"use client";

// Ship order button and the shipment record. The shipment is simulated.

import { useState } from "react";
import { CheckIcon, CopyIcon } from "@/components/icons";
import { copyText } from "@/lib/client/clipboard";
import type { ShipResponse } from "@/lib/client/agent-api";

interface Props {
  approval: string | null;
  shipResult: ShipResponse | null;
  busy: boolean;
  onShip: () => void;
}

// Matches APPROVAL_TTL_SECONDS in lib/agent/approval.ts (a test checks it).
export const APPROVAL_MINUTES = 5;

export default function ShipPanel({ approval, shipResult, busy, onShip }: Props) {
  const [copied, setCopied] = useState<"idle" | "yes" | "failed">("idle");
  const id = shipResult?.shipment.shipmentId ?? "";

  async function copy() {
    setCopied((await copyText(id)) ? "yes" : "failed");
  }

  return (
    <section aria-label="Ship" className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <button
        type="button"
        onClick={onShip}
        disabled={!approval || busy || Boolean(shipResult)}
        className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-accent px-4 text-base font-bold text-accent-ink hover:brightness-110 disabled:cursor-not-allowed disabled:bg-pending disabled:text-muted disabled:hover:brightness-100"
      >
        {shipResult ? "Shipped" : "Ship order"}
      </button>
      <p className="mt-2 text-sm text-muted">
        {shipResult
          ? "Shipped. Repeating this approval returns the same shipment."
          : approval
            ? "Approval received: the guard ALLOWed SHIP."
            : "Enabled only after the guard ALLOWs SHIP."}
      </p>
      {shipResult && (
        <div className="mt-3 space-y-2 text-sm" aria-live="polite">
          <div className="flex items-start justify-between gap-3 rounded-xl border border-allow-border bg-allow-bg p-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-widest text-allow-text">Shipment ID (simulated)</p>
              <p className="mt-1 break-all font-mono text-base text-ink">{id}</p>
            </div>
            <button
              type="button"
              onClick={copy}
              aria-label="Copy shipment ID"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-allow-border text-allow-text hover:bg-chip"
            >
              {copied === "yes" ? <CheckIcon /> : <CopyIcon />}
            </button>
          </div>
          {copied === "yes" && <p className="text-allow-text">Copied.</p>}
          {copied === "failed" && <p className="text-hold-text">Could not copy. Select the ID and copy it by hand.</p>}
          <p className="text-muted">
            Order <span className="font-mono text-soft">{shipResult.shipment.orderId}</span> · created{" "}
            <span className="font-mono text-soft">{shipResult.shipment.createdAt}</span>
          </p>
          <p className="text-muted">The approval is valid for {APPROVAL_MINUTES} minutes.</p>
        </div>
      )}
    </section>
  );
}
