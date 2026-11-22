import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getCurrentUser, ACTIVE_ORG_COOKIE } from "@/server/auth";
import { createClient } from "@/server/supabase/server";
import { Logo } from "@/components/brand/logo";
import { getDictionary } from "@/i18n/server";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/signup?next=${encodeURIComponent(`/invite/${token}`)}`);
  const t = await getDictionary();
  const supabase = await createClient();
  const { data: orgId, error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (!error && orgId) {
    (await cookies()).set(ACTIVE_ORG_COOKIE, String(orgId), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
    redirect("/overview");
  }
  const nl = t.meta.locale === "nl";
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-sidebar px-6">
      <Logo />
      <div className="max-w-md rounded-2xl border bg-background p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold">{nl ? "Uitnodiging ongeldig" : "Invitation invalid"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error?.message.includes("different email")
            ? nl ? `Deze uitnodiging is voor een ander e-mailadres dan ${user.email}.` : `This invitation was sent to a different address than ${user.email}.`
            : nl ? "De uitnodiging is verlopen, ingetrokken of al gebruikt." : "The invitation has expired, was revoked or was already used."}
        </p>
      </div>
    </div>
  );
}
