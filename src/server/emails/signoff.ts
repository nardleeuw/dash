/**
 * Every email ends with a greeting and the sender's name, whatever the model
 * did with the instructions (e.g. "last line exactly: <link>"). Pure — unit tested.
 */
export function ensureSignOff(
  body: string,
  sender: { signature: string | null; sender_name: string | null; agency_name: string; language: "nl" | "en"; formality?: "formal" | "informal" },
): string {
  let text = body.replace(/\?\./g, "?").replace(/!\./g, "!").replace(/[ \t]+$/gm, "").trimEnd();
  const tail = text.split("\n").slice(-6).join("\n").toLowerCase();
  const name = sender.sender_name?.trim();
  const sigFirst = sender.signature?.trim().split("\n").find((l) => l.trim())?.trim().toLowerCase();
  const signed =
    (name && tail.includes(name.toLowerCase())) ||
    (sigFirst && tail.includes(sigFirst)) ||
    /(met vriendelijke groet|vriendelijke groet|groeten|groet,|kind regards|best regards|regards,|cheers,)/i.test(tail);
  if (signed) return text;
  const closing = sender.signature?.trim()
    || [sender.language === "nl" ? (sender.formality === "informal" ? "Groet," : "Met vriendelijke groet,") : "Kind regards,", name || null, sender.agency_name].filter(Boolean).join("\n");
  text += `\n\n${closing}`;
  return text;
}
