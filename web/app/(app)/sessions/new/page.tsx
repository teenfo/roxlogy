import type { Metadata } from "next";
import { SessionNewForm } from "@/components/session-new-form";

export const metadata: Metadata = { title: "세션 기록 — Roxlogy" };

export default function SessionNewPage() {
  return <SessionNewForm />;
}
