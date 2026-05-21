import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Anchor, ArrowRight, Loader2, Mail } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { signInWithMagicLink } from "@/lib/auth";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

type State = "idle" | "loading" | "sent" | "error";

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;

    setState("loading");
    setError("");

    const callbackUrl = `${window.location.origin}/auth/callback`;
    const { error: authError } = await signInWithMagicLink(email.trim(), callbackUrl);

    if (authError) {
      setState("error");
      setError(authError.message);
    } else {
      setState("sent");
    }
  }

  // If Supabase isn't configured, skip auth and go straight in (dev convenience).
  if (!env.supabaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-950">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <BrandMark />
          <p className="text-sm text-stone-400">
            Supabase is not configured. Fill in{" "}
            <code className="font-mono">.env.local</code> then restart{" "}
            <code className="font-mono">npm run dev</code>.
          </p>
          <Button variant="ghost" onClick={() => void navigate({ to: "/" })}>
            Continue anyway (dev mode)
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-950 px-4">
      <div className="w-full max-w-sm">
        <BrandMark className="mb-8" />

        <h1 className="mb-1 text-xl font-semibold tracking-tight">
          Sign in to ShipSync
        </h1>
        <p className="mb-6 text-sm text-stone-400">
          We&apos;ll send a magic link to your email.
        </p>

        {state === "sent" ? (
          <SentConfirmation email={email} onBack={() => setState("idle")} />
        ) : (
          <form onSubmit={void handleSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-xs font-medium text-stone-300">
                Email address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
                <input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  placeholder="you@fullsailmarine.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-md border border-stone-700 bg-stone-900 py-2.5 pl-9 pr-3 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
            </div>

            {state === "error" && (
              <p className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={state === "loading" || !email.trim()}
              className="mt-1 w-full"
            >
              {state === "loading" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  Send magic link
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

function SentConfirmation({
  email,
  onBack,
}: {
  email: string;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-5 text-sm">
      <div className="flex flex-col gap-1">
        <p className="font-medium text-emerald-200">Check your email</p>
        <p className="text-stone-400">
          We sent a magic link to{" "}
          <span className="font-medium text-stone-200">{email}</span>. Click it
          to sign in — it expires in 60 minutes.
        </p>
      </div>
      <button
        onClick={onBack}
        className="self-start text-xs text-stone-500 underline-offset-2 hover:text-stone-300 hover:underline"
      >
        Use a different email
      </button>
    </div>
  );
}

function BrandMark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Anchor className="h-6 w-6 text-brand-500" />
      <span className="text-lg font-semibold tracking-tight">ShipSync</span>
    </div>
  );
}
