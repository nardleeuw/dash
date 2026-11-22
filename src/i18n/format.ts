/** Replace {placeholders} in a translated string. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export function formatNumber(n: number, locale = "nl-NL") {
  return new Intl.NumberFormat(locale).format(n);
}

export function formatPercent(n: number, locale = "nl-NL", digits = 1) {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: digits }).format(n);
}

export function formatCurrency(cents: number, locale = "nl-NL", currency = "EUR") {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

export function formatDate(value: string | Date | null | undefined, locale = "nl-NL", withTime = false) {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(d);
}
