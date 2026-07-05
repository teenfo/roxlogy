import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "로그인 — Roxlogy" };

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
