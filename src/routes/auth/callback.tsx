import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallbackPage,
});

function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const errorParam = url.searchParams.get("error_description");

    if (errorParam) {
      setError(errorParam);
      return;
    }

    const isRecovery =
      url.searchParams.get("type") === "recovery" ||
      new URLSearchParams(url.hash.slice(1)).get("type") === "recovery";

    if (!code) {
      if (isRecovery) {
        void navigate({ to: "/reset-password", replace: true });
        return;
      }
      // Implicit flow: detectSessionInUrl handled it already. Just navigate.
      void navigate({ to: "/", replace: true });
      return;
    }

    // PKCE flow: exchange the code for a session.
    supabase()
      .auth.exchangeCodeForSession(code)
      .then(({ error: authError }) => {
        if (authError) {
          setError(authError.message);
        } else if (isRecovery) {
          void navigate({ to: "/reset-password", replace: true });
        } else {
          void navigate({ to: "/", replace: true });
        }
      });
  }, [navigate]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-950 px-4">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <XCircle className="h-10 w-10 text-red-400" />
          <div>
            <p className="font-medium text-red-300">Sign-in failed</p>
            <p className="mt-1 text-sm text-stone-400">{error}</p>
          </div>
          <Button variant="outline" onClick={() => void navigate({ to: "/login" })}>
            Back to sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-950">
      <div className="flex flex-col items-center gap-3 text-stone-400">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Signing you in…</p>
      </div>
    </div>
  );
}
