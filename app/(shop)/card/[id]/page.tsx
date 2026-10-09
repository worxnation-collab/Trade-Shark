import { notFound } from "next/navigation";

/** Cards aren't sold one at a time; they're only shown inside a pack. */
export default function CardPage() {
  notFound();
}
