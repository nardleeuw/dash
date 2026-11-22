import { getDictionary } from "@/i18n/server";
import { requireUser } from "@/server/auth";
import { AuthForm } from "../auth-form";
import { updatePasswordAction } from "../actions";

export default async function ResetPasswordPage() {
  await requireUser();
  const t = await getDictionary();
  return (
    <div>
      <h1 className="mb-8 text-2xl font-semibold tracking-tight">{t.auth.resetTitle}</h1>
      <AuthForm
        action={updatePasswordAction}
        submitLabel={t.auth.setPassword}
        fields={[{ name: "password", type: "password", label: t.auth.newPassword, autoComplete: "new-password", hint: t.auth.passwordHint }]}
      />
    </div>
  );
}
