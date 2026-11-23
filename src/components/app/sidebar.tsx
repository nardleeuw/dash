"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTransition } from "react";
import {
  BarChart3, Building2, Check, ChevronsUpDown, CreditCard, Database, Globe, Inbox, KanbanSquare,
  LayoutDashboard, LogOut, Mail, Plug, Plus, Search, Settings, Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LogoMark } from "@/components/brand/logo";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/i18n/client";
import { switchWorkspaceAction, setLocaleAction } from "@/server/workspace/actions";
import { signOutAction } from "@/app/(auth)/actions";

type Membership = { orgId: string; orgName: string; role: string };

export type SidebarProps = {
  orgId: string;
  orgName: string;
  role: string;
  memberships: Membership[];
  userName: string;
  userEmail: string;
  inboxCount: number;
};

export function Sidebar(props: SidebarProps) {
  const t = useT();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  const work = [
    { href: "/overview", label: t.nav.overview, icon: LayoutDashboard },
    { href: "/discover", label: t.nav.discover, icon: Search },
    { href: "/leads", label: t.nav.leads, icon: Database },
    { href: "/emails", label: t.nav.emails, icon: Mail },
    { href: "/inbox", label: t.nav.inbox, icon: Inbox, badge: props.inboxCount },
    { href: "/crm", label: t.nav.crm, icon: KanbanSquare },
    { href: "/analytics", label: t.nav.analytics, icon: BarChart3 },
  ];
  const manage = [
    { href: "/clients", label: t.nav.clients, icon: Building2 },
    { href: "/integrations", label: t.nav.integrations, icon: Plug },
    { href: "/billing", label: t.nav.billing, icon: CreditCard },
    { href: "/settings", label: t.nav.settings, icon: Settings },
  ];

  const roles = t.roles as Record<string, string>;

  const renderItem = (item: (typeof work)[number]) => {
    const active = pathname === item.href || pathname.startsWith(item.href + "/");
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          "group flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          active && "bg-background text-foreground shadow-[0_1px_2px_rgba(16,24,40,0.06)] ring-1 ring-border",
        )}
      >
        <item.icon className={cn("size-4 text-muted-foreground group-hover:text-foreground", active && "text-primary")} />
        <span className="flex-1 truncate">{item.label}</span>
        {"badge" in item && item.badge ? (
          <span className="rounded-full bg-primary px-1.5 text-[11px] leading-5 font-semibold text-primary-foreground tabular">{item.badge}</span>
        ) : null}
      </Link>
    );
  };

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="p-3">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-sidebar-accent focus-visible:ring-[3px] focus-visible:ring-ring">
            <LogoMark className="size-7" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold">{props.orgName}</span>
              <span className="block truncate text-xs text-muted-foreground">{roles[props.role] ?? props.role}</span>
            </span>
            <ChevronsUpDown className="size-4 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="start">
            <DropdownMenuLabel>{t.nav.switchWorkspace}</DropdownMenuLabel>
            {props.memberships.map((m) => (
              <DropdownMenuItem key={m.orgId} disabled={pending} onSelect={() => startTransition(() => switchWorkspaceAction(m.orgId))}>
                <Globe />
                <span className="flex-1 truncate">{m.orgName}</span>
                {m.orgId === props.orgId && <Check className="!text-primary" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/onboarding?new=1"><Plus />{t.nav.newWorkspace}</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        <div className="space-y-0.5">
          <p className="px-2.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{t.nav.sectionWork}</p>
          {work.map(renderItem)}
        </div>
        <div className="space-y-0.5">
          <p className="px-2.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{t.nav.sectionManage}</p>
          {manage.map(renderItem)}
        </div>
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-sidebar-accent">
            <Avatar name={props.userName || props.userEmail} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium">{props.userName || props.userEmail}</span>
              <span className="block truncate text-xs text-muted-foreground">{props.userEmail}</span>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="start" side="top">
            <DropdownMenuItem asChild>
              <Link href="/settings"><Users />{t.nav.profile}</Link>
            </DropdownMenuItem>
            <DropdownMenuLabel>{t.nav.language}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => startTransition(() => setLocaleAction("nl"))}>
              <span className="w-4 text-center">🇳🇱</span> Nederlands {t.meta.locale === "nl" && <Check className="ml-auto !text-primary" />}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => startTransition(() => setLocaleAction("en"))}>
              <span className="w-4 text-center">🇬🇧</span> English {t.meta.locale === "en" && <Check className="ml-auto !text-primary" />}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => startTransition(() => signOutAction())}>
              <LogOut />{t.nav.signOut}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
