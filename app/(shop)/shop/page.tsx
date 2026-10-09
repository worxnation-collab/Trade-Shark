import { redirect } from "next/navigation";

/** Singles aren't sold any more: the catalog is the three packs on the home page. */
export default function Shop() {
  redirect("/");
}
