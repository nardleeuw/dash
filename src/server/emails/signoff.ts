/**
 * Every email ends with exactly one greeting and the sender's signature,
 * whatever the model did with the instructions (e.g. it wrote its own sign-off,
 * or put the call to action after the signature). Pure — unit tested.
 */
const GREETING = /^(met vriendelijke groet|vriendelijke groet(en)?|hartelijke groet(en)?|groet(en)?|kind regards|best regards|regards|cheers|warm regards)\s*[,!.]?$/i;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** Removes every occurrence of the signature block (matched line by line, blank lines ignored). */
function removeSignatureBlocks(lines: string[], sigLines: string[]): string[] {
  if (!sigLines.length) return lines;
  const out = [...lines];
  for (let i = 0; i < out.length; i++) {
    if (norm(out[i]) !== sigLines[0]) continue;
    const hit: number[] = [i];
    let j = i + 1;
    let k = 1;
    while (k < sigLines.length && j < out.length) {
      if (!out[j].trim()) { hit.push(j); j++; continue; }
      if (norm(out[j]) !== sigLines[k]) break;
      hit.push(j); j++; k++;
    }
    if (k === sigLines.length) {
      for (const idx of hit.reverse()) out.splice(idx, 1);
      i--;
    }
  }
  return out;
}

export function ensureSignOff(
  body: string,
  sender: { signature: string | null; sender_name: string | null; agency_name: string; language: "nl" | "en"; formality?: "formal" | "informal"; website?: string | null },
): string {
  const text = body.replace(/\?\./g, "?").replace(/!\./g, "!").replace(/[ \t]+$/gm, "").trimEnd();
  const name = sender.sender_name?.trim() ?? "";
  const signature = sender.signature?.trim() ?? "";
  const closing = signature
    || [sender.language === "nl" ? (sender.formality === "informal" ? "Groet," : "Met vriendelijke groet,") : "Kind regards,", name || null, sender.agency_name].filter(Boolean).join("\n");

  // 1. Drop every copy of the configured signature, wherever the model put it.
  let lines = removeSignatureBlocks(text.split("\n"), closing.split("\n").map(norm).filter(Boolean));

  // Leftovers of an older signature: contact details standing alone on a line
  // (website, email, phone, name) are signature material, never body text.
  const site = sender.website?.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase();
  const isContactLine = (l: string) => {
    const v = norm(l).replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (!v) return false;
    if (site && (v === site || v === `www.${site}`)) return true;
    if (name && v === norm(name)) return true;
    if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(v)) return true;
    return /^(\+|0)[\d\s().-]{8,}$/.test(v);
  };
  lines = lines.filter((l) => !isContactLine(l));

  // 2. Drop a sign-off the model wrote itself at the end: a greeting line followed only by
  //    short signature-like lines (name, role, phone, email, website).
  const nonEmpty = lines.map((l, i) => [l, i] as const).filter(([l]) => l.trim());
  for (let n = nonEmpty.length - 1; n >= Math.max(0, nonEmpty.length - 7); n--) {
    const [line, idx] = nonEmpty[n];
    if (GREETING.test(line.trim())) {
      const after = nonEmpty.slice(n + 1).map(([l]) => l.trim());
      if (after.every((l) => l.length <= 60 && !/[?]$/.test(l))) lines = lines.slice(0, idx);
      break;
    }
  }
  // A dangling greeting or bare name at the very end (e.g. "Groet,\nNard") is also replaced.
  while (lines.length && (!lines[lines.length - 1].trim() || (name && norm(lines[lines.length - 1]) === norm(name)))) lines.pop();

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n\n${closing}`;
}
