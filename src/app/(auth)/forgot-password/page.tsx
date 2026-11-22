import Link from "next/link";
import { getDictionary } from "@/i18n/server";
import { AuthForm } from "../auth-form";
import { requestResetAction } from "../actions";

export default async function ForgotPasswordPage() {
  const t = await getDictionary();
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t.auth.forgotTitle}</h1>
      <p className="mt-1.5 mb-8 text-sm text-muted-foreground">{t.auth.forgotSubtitle}</p>
      <AuthForm
        action={requestResetAction}
        submitLabel={t.auth.sendReset}
        fields={[{ name: "email", type: "email", label: t.auth.email, autoComplete: "email" }]}
        footer={<Link href="/login" className="block pt-2 text-sm text-muted-foreground hover:text-foreground">← {t.auth.login}</Link>}
      />
    </div>
  );
}
