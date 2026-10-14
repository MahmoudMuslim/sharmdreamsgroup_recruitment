"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/**
 * `compact` drops the label for the icon-only rail, where the button sits
 * beside an avatar. The icon is decorative, so the name moves onto the button.
 */
export function SignOutButton({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    startTransition(() => router.push("/login"));
    router.refresh();
  }

  const label = pending ? "Signing out" : "Sign out";

  return (
    <button
      type="button"
      onClick={() => void handleSignOut()}
      disabled={pending}
      aria-label={compact ? label : undefined}
      title={compact ? label : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-brand-line bg-white text-xs font-semibold text-brand-ink/70 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-60",
        compact ? "h-8 w-8 shrink-0 justify-center" : "px-3 py-1.5",
        className
      )}
    >
      <LogOut className="h-3.5 w-3.5" aria-hidden />
      {compact ? null : pending ? "Signing out…" : "Sign out"}
    </button>
  );
}