import { CheckCircle2, MailX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { verifyUnsubscribeToken } from "@/server/compliance/unsubscribe";
import { handleUnsubscribe } from "@/server/compliance/unsubscribe-handler";
import { getDictionary } from "@/i18n/server";
import { redirect } from "next/navigation";

export const metadata = { title: "Afmelden", robots: { index: false } };

async function confirm(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const res = await handleUnsubscribe(token, "link");
  redirect(`/u/${encodeURIComponent(token)}?done=${res.ok ? "1" : "0"}`);
}

export default async function UnsubscribePage({ params, searchParams }: PageProps<"/u/[token]">) {
  const { token } = await params;
  const { done } = await searchParams;
  const t = await getDictionary();
  const nl = t.meta.locale === "nl";
  const payload = verifyUnsubscribeToken(decodeURIComponent(token));
  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar px-6">
      <div className="w-full max-w-md rounded-2xl border bg-background p-8 text-center shadow-sm">
        {!payload ? (
          <p className="text-sm text-muted-foreground">{nl ? "Deze afmeldlink is ongeldig." : "This unsubscribe link is invalid."}</p>
        ) : done === "1" ? (
          <>
            <CheckCircle2 className="mx-auto size-10 text-success" />
            <h1 className="mt-4 text-lg font-semibold">{nl ? "U bent afgemeld" : "You have been unsubscribed"}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{nl ? `${payload.e} ontvangt geen berichten meer van deze afzender.` : `${payload.e} will no longer receive messages from this sender.`}</p>
          </>
        ) : (
          <form action={confirm}>
            <MailX className="mx-auto size-10 text-muted-foreground" />
            <h1 className="mt-4 text-lg font-semibold">{nl ? "Afmelden" : "Unsubscribe"}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{nl ? `Wilt u ${payload.e} afmelden voor verdere berichten?` : `Unsubscribe ${payload.e} from further messages?`}</p>
            <input type="hidden" name="token" value={decodeURIComponent(token)} />
            <Button type="submit" className="mt-6 w-full">{nl ? "Afmelden bevestigen" : "Confirm unsubscribe"}</Button>
          </form>
        )}
      </div>
    </div>
  );
}
