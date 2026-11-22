import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { getDictionary } from "@/i18n/server";
import { requireUser } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { OnboardingForm } from "./form";

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const user = await requireUser();
  const t = await getDictionary();
  const { new: isNew } = await searchParams;
  const supabase = await createClient();
  const { count } = await supabase.from("organization_members").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  if ((count ?? 0) > 0 && !isNew) redirect("/overview");
  return (
    <div className="flex min-h-screen flex-col bg-sidebar px-6 py-8">
      <Logo />
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-md rounded-2xl border bg-background p-8 shadow-sm">
          <h1 className="text-xl font-semibold tracking-tight">{t.onboarding.title}</h1>
          <p className="mt-1.5 mb-6 text-sm text-muted-foreground">{t.onboarding.subtitle}</p>
          <OnboardingForm />
          <p className="mt-6 text-xs text-muted-foreground">{t.onboarding.invitedHint}</p>
        </div>
      </div>
    </div>
  );
}
