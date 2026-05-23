import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Package, Printer, Truck } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { usePackingDocs, useSignPod } from "@/hooks/usePackJobs";
import { ensurePackingDocs } from "@/lib/queryPrefetch";
import { isInitialQueryLoad } from "@/lib/queryLoading";
import {
  groupDocLinesBySku,
  groupPackageContentsForList,
  type DocLineInput,
} from "@/lib/packingDocs";
import { formatCurrency } from "@/lib/utils";
import { statusLabel } from "@/components/ui/badge";

export const Route = createFileRoute("/_authed/warehouse/docs/$cspoId")({
  loader: ({ context: { queryClient }, params: { cspoId } }) =>
    ensurePackingDocs(queryClient, cspoId),
  component: PackingDocsPage,
  validateSearch: (s: Record<string, unknown>) => ({
    invoice: typeof s.invoice === "string" ? s.invoice : undefined,
  }),
});

function PackingDocsPage() {
  const { cspoId } = Route.useParams();
  const { invoice: invoiceHint } = Route.useSearch();
  const { data, isPending, error } = usePackingDocs(cspoId);
  const signPod = useSignPod();

  const [freightCompany, setFreightCompany] = useState("");
  const [driverName, setDriverName] = useState("");
  const [showPod, setShowPod] = useState(false);
  const [podMsg, setPodMsg] = useState<string | null>(null);

  const allContents = useMemo(
    () =>
      (data?.packages ?? []).flatMap(
        (pkg) => (pkg.contents ?? []) as unknown as DocLineInput[],
      ),
    [data?.packages],
  );
  const invoiceLines = useMemo(() => groupDocLinesBySku(allContents), [allContents]);
  const invoiceSkuCount = invoiceLines.filter((l) => !l.is_custom).length;
  const invoiceUnitCount = invoiceLines.reduce((s, l) => s + l.qty, 0);

  if (isInitialQueryLoad(isPending, data)) {
    return <div className="py-24 text-center text-sm text-stone-500">Loading docs…</div>;
  }

  if (error || !data) {
    return (
      <div className="py-24 text-center text-sm text-red-400">
        {(error as Error)?.message ?? "Documents not found"}
      </div>
    );
  }

  const { cspo, packages, invoice, pod } = data;
  const vessel = cspo.vessel as unknown as {
    name: string;
    fleet: { name: string } | null;
  } | null;

  const packingIncomplete = cspo.status === "packing" || cspo.status === "active";
  const noPackages = packages.length === 0;
  const noInvoice = !invoice;
  const emptyInvoice = invoiceLines.length === 0;
  const docsReady = !packingIncomplete && !noPackages && !noInvoice && !emptyInvoice;

  async function handleSignPod(e: FormEvent) {
    e.preventDefault();
    if (!pod) return;
    setPodMsg(null);
    const result = await signPod.mutateAsync({
      podId: pod.id,
      cspoId,
      freightCompany: freightCompany.trim(),
      driverName: driverName.trim(),
    });
    if (result.queued) {
      setPodMsg("Saved offline — POD signature queued for sync");
    }
    setShowPod(false);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 print:max-w-none">
      <div className="flex items-center justify-between print:hidden">
        <Link
          to="/warehouse"
          className="flex items-center gap-1.5 text-sm text-stone-400 hover:text-stone-200"
        >
          <ArrowLeft className="h-4 w-4" /> Warehouse
        </Link>
        {docsReady && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print
            </Button>
            {pod && !pod.signed_at && (
              <Button onClick={() => setShowPod(true)}>
                <Truck className="h-4 w-4" /> Capture POD
              </Button>
            )}
          </div>
        )}
      </div>

      {!docsReady && (
        <Card className="p-8 text-center print:hidden">
          <Package className="mx-auto mb-4 h-10 w-10 text-stone-600" />
          <h2 className="text-lg font-medium text-stone-200">Shipping docs not ready</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">
            {packingIncomplete
              ? "Finish packing and complete the session to generate the commercial invoice and packing list."
              : noPackages
                ? "No packages have been created for this CSPO yet."
                : noInvoice
                  ? "Commercial invoice has not been issued yet — complete packing first."
                  : "Packages exist but have no line contents for the invoice."}
          </p>
          <Link
            to="/warehouse/pack/$cspoId"
            params={{ cspoId }}
            className="mt-5 inline-block"
          >
            <Button>
              <Package className="h-4 w-4" /> Go to pack session
            </Button>
          </Link>
          <p className="mt-4 font-mono text-xs text-stone-600">{cspo.cspo_number}</p>
        </Card>
      )}

      {docsReady && (
        <>
      {/* Commercial Invoice */}
      <article className="rounded-lg border border-stone-800 bg-white p-8 text-stone-900 print:border-0 print:p-0">
        <header className="mb-8 border-b border-stone-200 pb-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Commercial Invoice</h1>
              <p className="mt-1 text-sm text-stone-600">Full Sail Marine</p>
            </div>
            <div className="text-right text-sm">
              <p className="font-mono font-semibold">
                {invoice?.invoice_number ?? invoiceHint ?? "—"}
              </p>
              <p className="text-stone-600">
                {invoice?.issued_at
                  ? new Date(invoice.issued_at).toLocaleDateString()
                  : new Date().toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs uppercase text-stone-500">Ship to</p>
              <p className="font-medium">{vessel?.name}</p>
              <p className="text-stone-600">{vessel?.fleet?.name}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-stone-500">PO reference</p>
              <p className="font-mono font-medium">{cspo.cspo_number}</p>
              {cspo.port_of_service && (
                <p className="text-stone-600">{cspo.port_of_service}</p>
              )}
            </div>
          </div>
        </header>

        <p className="mb-4 text-xs text-stone-500">
          {invoiceSkuCount} SKUs · {invoiceUnitCount} units · {packages.length} packages
        </p>

        <table className="mb-8 w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
              <th className="py-2 font-medium">Item</th>
              <th className="py-2 font-medium">HTS</th>
              <th className="py-2 text-right font-medium">Qty</th>
              <th className="py-2 text-right font-medium">Unit</th>
              <th className="py-2 text-right font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {invoiceLines.map((line) => (
              <tr key={line.key} className="border-b border-stone-100">
                <td className="py-2">
                  <span className="font-mono text-stone-800">{line.sku_code}</span>
                  <span className="text-stone-600"> — {line.name}</span>
                </td>
                <td className="py-2 font-mono text-stone-600">{line.hts_code ?? "—"}</td>
                <td className="py-2 text-right font-mono">{line.qty}</td>
                <td className="py-2 text-right font-mono text-stone-600">
                  {formatCurrency(line.unit_cost, cspo.currency)}
                </td>
                <td className="py-2 text-right font-mono">
                  {formatCurrency(line.line_total, cspo.currency)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="pt-4 text-right font-medium">
                Total
              </td>
              <td className="pt-4 text-right font-mono text-lg font-semibold">
                {formatCurrency(
                  Number(invoice?.total_value ?? 0),
                  invoice?.currency ?? cspo.currency,
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </article>

      {/* Packing List */}
      <article className="rounded-lg border border-stone-800 bg-white p-8 text-stone-900 print:break-before-page print:border-0 print:p-0">
        <header className="mb-6 border-b border-stone-200 pb-4">
          <h1 className="text-2xl font-bold">Packing List</h1>
          <p className="text-sm text-stone-600">
            {cspo.cspo_number} · {vessel?.name}
          </p>
        </header>

        {packages.map((pkg) => {
          const lines = groupPackageContentsForList(
            (pkg.contents ?? []) as unknown as DocLineInput[],
          );
          const unitCount = lines.reduce((s, l) => s + l.qty, 0);
          return (
          <div key={pkg.id} className="mb-6">
            <h2 className="mb-2 text-sm font-semibold capitalize">
              {statusLabel(pkg.package_type)} #{pkg.package_number}
              <span className="ml-2 font-normal text-stone-500">
                · {lines.length} SKUs · {unitCount} units
              </span>
              {pkg.length && (
                <span className="ml-2 font-normal text-stone-500">
                  ({pkg.length}×{pkg.width}×{pkg.height} in, {pkg.weight} lb)
                </span>
              )}
            </h2>
            <ul className="list-inside list-disc text-sm text-stone-700">
              {lines.map((line) => (
                <li key={line.sku_code + line.label}>
                  {line.qty > 1 && <span className="font-mono">{line.qty}× </span>}
                  {line.label}
                </li>
              ))}
            </ul>
          </div>
          );
        })}
      </article>

      {/* POD */}
      {(pod?.signed_at || showPod) && (
        <Card className="p-6 print:break-before-page">
          <h2 className="mb-4 text-lg font-semibold">Proof of Delivery</h2>
          {podMsg && (
            <p className="mb-3 rounded-md border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-sm text-amber-200">
              {podMsg}
            </p>
          )}
          {pod?.signed_at ? (
            <div className="text-sm text-stone-300">
              <p>Signed {new Date(pod.signed_at).toLocaleString()}</p>
              <p>Freight: {pod.freight_company}</p>
              <p>Driver: {pod.driver_name}</p>
            </div>
          ) : (
            <form onSubmit={(e) => void handleSignPod(e)} className="flex flex-col gap-3">
              <input
                required
                placeholder="Freight company"
                value={freightCompany}
                onChange={(e) => setFreightCompany(e.target.value)}
                className={inputClass}
              />
              <input
                required
                placeholder="Driver name"
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                className={inputClass}
              />
              {signPod.error && (
                <p className="text-xs text-red-400">{(signPod.error as Error).message}</p>
              )}
              <Button type="submit" disabled={signPod.isPending}>
                Capture signature
              </Button>
            </form>
          )}
        </Card>
      )}
        </>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100";
