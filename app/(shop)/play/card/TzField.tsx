"use client";

import { useEffect, useState } from "react";

/** Your time zone, so the daily look count resets at your midnight. */
export function TzField() {
  const [tz, setTz] = useState("");
  useEffect(() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || ""), []);
  return <input type="hidden" name="tz" value={tz} />;
}
