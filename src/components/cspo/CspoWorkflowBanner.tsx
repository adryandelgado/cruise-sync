import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  ClipboardList,
  Package,
  PackageCheck,
  Ship,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Step = {
  id: string;
  label: string;
  done: boolean;
  active: boolean;
  href?: string;
  hint?: string;
};

type Props = {
  cspoId: string;
  cspoStatus: string;
  listStatus: string | null;
  listItemCount: number;
  unitsAboard: number;
  skuCountAboard: number;
  pendingReceipts?: number;
  totalPackages?: number;
  blockingUnits?: number;
  pendingOutboundTransfers?: number;
};

export function CspoWorkflowBanner({
  cspoId,
  cspoStatus,
  listStatus,
  listItemCount,
  unitsAboard,
  skuCountAboard,
  pendingReceipts = 0,
  totalPackages = 0,
  blockingUnits = 0,
  pendingOutboundTransfers = 0,
}: Props) {
  if (cspoStatus === "closed" || cspoStatus === "cancelled") return null;

  const listSubmitted = listStatus != null && listStatus !== "draft";
  const packingDone = listStatus === "complete";
  const shipped = ["in_transit", "on_vessel", "in_progress", "closing"].includes(cspoStatus);
  const aboard = ["on_vessel", "in_progress", "closing"].includes(cspoStatus);

  // All freight scanned aboard (or no packages were shipped).
  const receiveDone =
    pendingReceipts === 0 &&
    (shipped || aboard) &&
    (totalPackages > 0 || unitsAboard > 0 || aboard);

  const steps: Step[] = [
    {
      id: "list",
      label: "Material list",
      done: listSubmitted && listItemCount > 0,
      active: cspoStatus === "active" || cspoStatus === "packing",
      href: undefined,
      hint:
        listItemCount === 0
          ? "Add SKUs on this page"
          : listSubmitted
            ? `${listItemCount} lines submitted`
            : "Submit list for warehouse",
    },
    {
      id: "pack",
      label: "Warehouse pack",
      done: packingDone || shipped,
      active: listSubmitted && !packingDone && cspoStatus === "packing",
      href: `/warehouse/pack/${cspoId}`,
      hint: packingDone ? "Packing complete" : "Pack & generate docs",
    },
    {
      id: "receive",
      label: "Receive aboard",
      done: receiveDone,
      active: cspoStatus === "in_transit" && pendingReceipts > 0,
      href: `/onboard/receive/${cspoId}`,
      hint:
        pendingReceipts > 0
          ? `${pendingReceipts} package(s) pending`
          : unitsAboard > 0
            ? `${skuCountAboard} SKUs · ${unitsAboard} units aboard`
            : receiveDone
              ? "All packages received"
              : "Scan packages aboard",
    },
    {
      id: "work",
      label: "Aboard ops",
      done: receiveDone && aboard && blockingUnits === 0 && unitsAboard === 0,
      active: receiveDone && aboard && unitsAboard > 0,
      href: `/onboard/log/${cspoId}`,
      hint:
        !receiveDone
          ? "After receive"
          : unitsAboard > 0
            ? "Log usage · return · transfer"
            : aboard
              ? "Inventory cleared"
              : "After receive",
    },
    {
      id: "close",
      label: "Close CSPO",
      done: false,
      active:
        receiveDone &&
        aboard &&
        blockingUnits === 0 &&
        pendingOutboundTransfers === 0 &&
        unitsAboard === 0,
      hint:
        !receiveDone
          ? "Finish receive first"
          : blockingUnits > 0
            ? `${blockingUnits} units still blocking`
            : pendingOutboundTransfers > 0
              ? "Outbound transfers pending ack"
              : unitsAboard > 0
                ? "Clear aboard inventory first"
                : "Ready to sign off",
    },
  ];

  const activeStep = steps.find((s) => s.active) ?? steps.find((s) => !s.done);

  return (
    <Card className="border-stone-800 bg-stone-900/40 p-4">
      <div className="mb-3 flex items-start gap-2">
        {activeStep && !activeStep.done ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        )}
        <div>
          <p className="text-sm font-medium text-stone-200">Workflow</p>
          <p className="text-xs text-stone-500">
            {activeStep && !activeStep.done
              ? `Next: ${activeStep.label} — ${activeStep.hint}`
              : "All steps complete — ready to close when work is done"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {steps.map((step, i) => {
          const icon =
            step.id === "list" ? ClipboardList :
            step.id === "pack" ? Package :
            step.id === "receive" ? PackageCheck :
            step.id === "work" ? Ship : CheckCircle2;

          const Icon = icon;
          const content = (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs",
                step.done && "border-emerald-900/50 bg-emerald-950/20 text-emerald-300",
                step.active && !step.done && "border-amber-900/50 bg-amber-950/20 text-amber-200",
                !step.done && !step.active && "border-stone-800 text-stone-500",
              )}
            >
              {step.done ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : step.active ? (
                <Icon className="h-3.5 w-3.5" />
              ) : (
                <Circle className="h-3.5 w-3.5" />
              )}
              {i + 1}. {step.label}
            </span>
          );

          if (step.href && (step.active || step.done)) {
            return (
              <Link key={step.id} to={step.href}>
                {content}
              </Link>
            );
          }
          return <span key={step.id}>{content}</span>;
        })}
      </div>
    </Card>
  );
}
