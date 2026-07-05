import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "가입 — Roxlogy" };

export default function SignupPage() {
  return <AuthForm mode="signup" />;
}
