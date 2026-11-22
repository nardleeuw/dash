import "server-only";
import { cookies } from "next/headers";
import { nl, type Dictionary } from "./nl";
import { en } from "./en";

export type Locale = "nl" | "en";
export const LOCALE_COOKIE = "lw_locale";

const dictionaries: Record<Locale, Dictionary> = { nl, en };

export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return value === "en" ? "en" : "nl";
}

export async function getDictionary(locale?: Locale): Promise<Dictionary> {
  return dictionaries[locale ?? (await getLocale())];
}
