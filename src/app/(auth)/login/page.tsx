import Link from "next/link";
import { getDictionary } from "@/i18n/server";
import { AuthForm } from "../auth-form";
import { signInAction } from "../actions";

export const metadata = { title: "Login" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const t = await getDictionary();
  const { next } = await searchParams;
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t.auth.loginTitle}</h1>
      <p className="mt-1.5 mb-8 text-sm text-muted-foreground">{t.auth.loginSubtitle}</p>
      <AuthForm
        action={signInAction}
        submitLabel={t.auth.login}
        hidden={{ next: typeof next === "string" ? next : "/overview" }}
        fields={[
          { name: "email", type: "email", label: t.auth.email, autoComplete: "email" },
          { name: "password", type: "password", label: t.auth.password, autoComplete: "current-password" },
        ]}
        footer={
          <div className="flex items-center justify-between pt-2 text-sm">
            <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground">{t.auth.forgot}</Link>
            <span className="text-muted-foreground">
              {t.auth.noAccount} <Link href="/signup" className="font-medium text-primary hover:underline">{t.auth.signup}</Link>
            </span>
          </div>
        }
      />
    </div>
  );
}
