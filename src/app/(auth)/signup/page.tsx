import Link from "next/link";
import { getDictionary } from "@/i18n/server";
import { AuthForm } from "../auth-form";
import { signUpAction } from "../actions";

export const metadata = { title: "Sign up" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const t = await getDictionary();
  const { next } = await searchParams;
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t.auth.signupTitle}</h1>
      <p className="mt-1.5 mb-8 text-sm text-muted-foreground">{t.auth.signupSubtitle}</p>
      <AuthForm
        action={signUpAction}
        submitLabel={t.auth.signup}
        hidden={typeof next === "string" ? { next } : undefined}
        fields={[
          { name: "fullName", type: "text", label: t.auth.fullName, autoComplete: "name" },
          { name: "email", type: "email", label: t.auth.email, autoComplete: "email" },
          { name: "password", type: "password", label: t.auth.password, autoComplete: "new-password", hint: t.auth.passwordHint },
        ]}
        footer={
          <div className="space-y-3 pt-2 text-sm">
            <p className="text-xs text-muted-foreground">{t.auth.termsNotice}</p>
            <p className="text-muted-foreground">
              {t.auth.haveAccount} <Link href="/login" className="font-medium text-primary hover:underline">{t.auth.login}</Link>
            </p>
          </div>
        }
      />
    </div>
  );
}
