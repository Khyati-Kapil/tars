"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ReactNode } from "react";
import { convex } from "@/lib/convex";

export function Providers({ children }: { children: ReactNode }) {
  if (!convex) {
    return (
      <ClerkProvider>
        <main className="grid min-h-screen place-items-center p-6 text-center text-sm text-slate-700">
          <p>
            Missing <code>NEXT_PUBLIC_CONVEX_URL</code>. Add env variables and restart the
            server.
          </p>
        </main>
      </ClerkProvider>
    );
  }

  return (
    <ClerkProvider>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        {children}
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
