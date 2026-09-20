import { notFound } from "next/navigation";
import { getAdmin } from "@/lib/admin";
import { AdminNav } from "@/components/rox/admin-nav";

/** 관리자 라우트 — 시안 account.tsx Admin() 의 PageHead + NavTabs 를 레이아웃이 그린다 (PORT_PLAN §3-f). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { isAdmin } = await getAdmin();
  if (!isAdmin) notFound();
  return (
    <>
      <AdminNav />
      {children}
    </>
  );
}
