import { getT } from "@/lib/i18n";
import { AuthForm } from "@/components/auth-form";

export async function generateMetadata() {
  const { t } = await getT();
  return { title: t("meta.signup") };
}

export default function SignupPage() {
  return <AuthForm mode="signup" />;
}
