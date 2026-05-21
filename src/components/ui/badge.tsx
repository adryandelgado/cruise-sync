import { cva, type VariantProps } from "class-variance-authority";
import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
  {
    variants: {
      variant: {
        draft:       "bg-stone-800 text-stone-300 ring-stone-700",
        active:      "bg-blue-950 text-blue-300 ring-blue-800",
        packing:     "bg-amber-950 text-amber-300 ring-amber-800",
        in_transit:  "bg-orange-950 text-orange-300 ring-orange-800",
        on_vessel:   "bg-emerald-950 text-emerald-300 ring-emerald-800",
        in_progress: "bg-cyan-950 text-cyan-300 ring-cyan-800",
        closing:     "bg-yellow-950 text-yellow-300 ring-yellow-800",
        closed:      "bg-stone-900 text-stone-500 ring-stone-800",
        cancelled:   "bg-red-950 text-red-400 ring-red-900",
        in_service:  "bg-sky-950 text-sky-300 ring-sky-800",
        in_drydock:  "bg-violet-950 text-violet-300 ring-violet-800",
      },
    },
    defaultVariants: { variant: "draft" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function statusLabel(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
