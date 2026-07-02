"use client";

import { useEffect } from "react";
import { deleteExpiredSessions } from "@/lib/storage";

export function useRetentionCleanup(): void {
  useEffect(() => {
    deleteExpiredSessions().catch(console.error);
  }, []);
}
