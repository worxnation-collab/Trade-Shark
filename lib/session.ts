import { cookies } from "next/headers";
import { COOKIE, isValidSession } from "./auth";

/** Defense in depth for route handlers (middleware already gates /admin and /api/admin). */
export async function requireSession() {
  const jar = await cookies();
  return isValidSession(jar.get(COOKIE)?.value);
}
