import Link from "next/link";
import { cn } from "@/lib/utils";
import { getDictionary } from "@/i18n/server";

/** One "Instellingen" area: tabs across settings, mailbox and billing pages. */
export async function SettingsNav({ active }: { active: "sender" | "mailbox" | "company" | "billing" | "account" }) {
  const t = await getDictionary();
  const s = t.settingsNav;
  const items = [
    { key: "sender", href: "/settings?tab=sender", label: s.sender },
    { key: "mailbox", href: "/integrations", label: s.mailbox },
    { key: "company", href: "/settings?tab=organization", label: s.company },
    { key: "billing", href: "/billing", label: s.billing },
    { key: "account", href: "/settings?tab=profile", label: s.account },
  ] as const;
  return (
    <nav className="mb-6 flex flex-wrap gap-1 rounded-lg bg-secondary p-1">
      {items.map((i) => (
        <Link key={i.key} href={i.href} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", active === i.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
