import { EmptyState } from "@/components/Brand";

/** Public fallback: never show visitors a stack trace or config details. */
export function ShopUnavailable() {
  return (
    <EmptyState title="The case is being restocked">
      The shop is temporarily unavailable. Check back soon, or use the Contact page to ask about a card.
    </EmptyState>
  );
}
