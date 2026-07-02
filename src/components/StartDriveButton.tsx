"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getLastSession } from "@/lib/storage";

export function StartDriveButton() {
  const [hasLastSession, setHasLastSession] = useState(false);

  useEffect(() => {
    getLastSession().then((session) => setHasLastSession(Boolean(session))).catch(() => setHasLastSession(false));
  }, []);

  return (
    <Link
      href="/drive"
      onClick={(event) => {
        if (hasLastSession && !window.confirm("Starting a new drive will replace the previous unprotected local drive. Continue?")) event.preventDefault();
      }}
      className="touch-target flex w-full items-center justify-center rounded-lg bg-signal-blue px-5 py-4 text-lg font-black text-cockpit-950 shadow-glow"
    >
      Start Drive
    </Link>
  );
}
