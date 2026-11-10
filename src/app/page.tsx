"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/providers";
import { Loading } from "@/components/ui";

export default function Home() {
  const { me, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    router.replace(!me ? "/login" : me.role === "system_admin" ? "/system" : "/overview");
  }, [me, loading, router]);
  return <div className="grid min-h-dvh place-items-center"><Loading /></div>;
}
