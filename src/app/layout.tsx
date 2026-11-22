import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n/client";
import { getDictionary, getLocale } from "@/i18n/server";
import { BRAND } from "@/config/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: BRAND.name, template: `%s · ${BRAND.name}` },
  description: BRAND.description,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const dictionary = await getDictionary(locale);
  return (
    <html lang={locale} className={`${GeistSans.variable} ${GeistMono.variable} h-full`}>
      <body className="min-h-full font-sans antialiased">
        <I18nProvider dictionary={dictionary}>
          <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        </I18nProvider>
        <Toaster position="bottom-right" toastOptions={{ classNames: { toast: "!rounded-lg !border !shadow-lg !text-sm" } }} />
      </body>
    </html>
  );
}
