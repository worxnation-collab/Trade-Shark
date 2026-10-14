import { EmptyState } from "@/components/Brand";

/** Public fallback: never show visitors a stack trace or config details. */
export function ShopUnavailable() {
  return (
    <EmptyState title="This page didn't load">
      The shop is still here. Refresh and try again. If a pack is open, it is still waiting.
    </EmptyState>
  );
}
