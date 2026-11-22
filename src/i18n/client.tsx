"use client";
import { createContext, useContext } from "react";
import type { Dictionary } from "./nl";

const I18nContext = createContext<Dictionary | null>(null);

export function I18nProvider({ dictionary, children }: { dictionary: Dictionary; children: React.ReactNode }) {
  return <I18nContext value={dictionary}>{children}</I18nContext>;
}

export function useT(): Dictionary {
  const t = useContext(I18nContext);
  if (!t) throw new Error("useT must be used within I18nProvider");
  return t;
}
