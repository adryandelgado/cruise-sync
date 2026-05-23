import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Anchor, ArrowRight, Loader2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { updatePassword } from "@/lib/auth";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!env.supabaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-950 px-4">
        <p className="text-sm text-stone-400">Supabase is not configured.</p>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    setError("");

    const { error: authError } = await updatePassword(password);
    setLoading(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    void navigate({ to: "/" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-950 px-4">
      <div className="w-full max-w-sm">
        <BrandMark className="mb-8" />
        <h1 className="mb-1 text-xl font-semibold tracking-tight">Set a new password</h1>
        <p className="mb-6 text-sm text-stone-400">
          Choose a new password for your ShipSync account.
        </p>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-xs font-medium text-stone-300">
              New password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="confirm" className="text-xs font-medium text-stone-300">
              Confirm password
            </label>
            <input
              id="confirm"
              type="password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputClass}
            />
          </div>

          {error && (
            <p className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading || !password || !confirm} className="mt-1 w-full">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                Update password
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-stone-700 bg-stone-900 px-3 py-2.5 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500";

function BrandMark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Anchor className="h-6 w-6 text-brand-500" />
      <span className="text-lg font-semibold tracking-tight">ShipSync</span>
    </div>
  );
}
