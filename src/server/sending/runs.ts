/** Name for an automatic send run ("Verzending 23-11 14:05 · info@agency.nl"). */
export function sendRunName(fromAddress: string | null, now = new Date()) {
  const stamp = now.toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", "");
  return `Verzending ${stamp}${fromAddress ? ` · ${fromAddress}` : ""}`.slice(0, 160);
}
