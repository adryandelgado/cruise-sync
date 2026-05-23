import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Anchor, ArrowRight, Eye, EyeOff, Loader2, Mail } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { requestPasswordReset, signInWithMagicLink, signInWithPassword } from "@/lib/auth";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

type Mode = "password" | "magic" | "forgot";
type State = "idle" | "loading" | "sent" | "error";

function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setState("loading");
    setError("");

    if (mode === "password") {
      const { error: authError } = await signInWithPassword(email.trim(), password);
      if (authError) {
        setState("error");
        setError(authError.message);
      } else {
        void navigate({ to: "/" });
      }
    } else if (mode === "forgot") {
      const callbackUrl = `${window.location.origin}/auth/callback?type=recovery`;
      const { error: authError } = await requestPasswordReset(email.trim(), callbackUrl);
      if (authError) {
        setState("error");
        setError(authError.message);
      } else {
        setState("sent");
      }
    } else {
      const callbackUrl = `${window.location.origin}/auth/callback`;
      const { error: authError } = await signInWithMagicLink(email.trim(), callbackUrl);
      if (authError) {
        setState("error");
        setError(authError.message);
      } else {
        setState("sent");
      }
    }
  }

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
            Continue anyway (dev)
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

        {/* Mode toggle */}
        <div className="mb-6 flex gap-1 rounded-lg border border-stone-800 bg-stone-900 p-1">
          <ModeButton active={mode === "password"} onClick={() => { setMode("password"); setState("idle"); setError(""); }}>
            Password
          </ModeButton>
          <ModeButton active={mode === "magic"} onClick={() => { setMode("magic"); setState("idle"); setError(""); }}>
            Magic link
          </ModeButton>
        </div>

        {state === "sent" ? (
          mode === "forgot" ? (
            <ResetSentConfirmation email={email} onBack={() => { setMode("password"); setState("idle"); }} />
          ) : (
            <SentConfirmation email={email} onBack={() => setState("idle")} />
          )
        ) : mode === "forgot" ? (
          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
            <p className="text-sm text-stone-400">
              Enter your email and we&apos;ll send a link to reset your password.
            </p>
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
            <Button type="submit" disabled={state === "loading" || !email.trim()} className="mt-1 w-full">
              {state === "loading" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  Send reset link
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
            <button
              type="button"
              onClick={() => { setMode("password"); setState("idle"); setError(""); }}
              className="text-xs text-stone-500 underline-offset-2 hover:text-stone-300 hover:underline"
            >
              Back to sign in
            </button>
          </form>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
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

            {mode === "password" && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="password" className="text-xs font-medium text-stone-300">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-md border border-stone-700 bg-stone-900 py-2.5 pl-3 pr-9 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-stone-300"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-stone-500">
                    New user?{" "}
                    <span className="text-stone-400">
                      Supabase → Authentication → Users → Add user
                    </span>
                  </p>
                  <button
                    type="button"
                    onClick={() => { setMode("forgot"); setState("idle"); setError(""); }}
                    className="shrink-0 text-xs text-brand-400 underline-offset-2 hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
              </div>
            )}

            {state === "error" && (
              <p className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={state === "loading" || !email.trim() || (mode === "password" && !password)}
              className="mt-1 w-full"
            >
              {state === "loading" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {mode === "password" ? "Signing in…" : "Sending…"}
                </>
              ) : (
                <>
                  {mode === "password" ? "Sign in" : "Send magic link"}
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

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-md py-1.5 text-xs font-medium transition-colors",
        active
          ? "bg-stone-800 text-stone-100"
          : "text-stone-500 hover:text-stone-300",
      )}
    >
      {children}
    </button>
  );
}

function ResetSentConfirmation({ email, onBack }: { email: string; onBack: () => void }) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-5 text-sm">
      <div className="flex flex-col gap-1">
        <p className="font-medium text-emerald-200">Check your email</p>
        <p className="text-stone-400">
          If an account exists for{" "}
          <span className="font-medium text-stone-200">{email}</span>, we sent a
          password reset link. Click it to choose a new password.
        </p>
        <p className="mt-2 text-xs text-stone-500">
          Email not arriving? Use Supabase Dashboard → Users → Add user with a password,
          or reset via the service-role API while SMTP is being configured.
        </p>
      </div>
      <button
        onClick={onBack}
        className="self-start text-xs text-stone-500 underline-offset-2 hover:text-stone-300 hover:underline"
      >
        Back to sign in
      </button>
    </div>
  );
}

function SentConfirmation({ email, onBack }: { email: string; onBack: () => void }) {
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
