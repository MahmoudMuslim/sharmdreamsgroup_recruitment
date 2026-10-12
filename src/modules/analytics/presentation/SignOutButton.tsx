"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    startTransition(() => router.push("/login"));
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={() => void handleSignOut()}
      disabled={pending}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white px-3 py-1.5 text-xs font-semibold text-brand-ink/70 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-60",
        className
      )}
    >
      <LogOut className="h-3.5 w-3.5" aria-hidden />
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}