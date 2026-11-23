/**
 * Sender identity shown under every email. One rule for every send path
 * (send runs, inbox replies, overview checklist, settings form). Pure — unit tested.
 */

/** A postcode followed by a place: "3511 AA Utrecht", "Kamille 2a, 5248 AB Rosmalen", "1000 Brussel". */
const POSTCODE_AND_PLACE = /\b\d{4,5}\s?[A-Za-z]{0,2}\b[\s,]+[A-Za-zÀ-ÿ'’-]{2,}/;

export function postalAddressComplete(address: string | null | undefined): boolean {
  const a = address?.trim() ?? "";
  return a.length >= 8 && /[A-Za-zÀ-ÿ]{2,}.*\d/.test(a) && POSTCODE_AND_PLACE.test(a);
}

export function senderIdentityComplete(org: { legal_name?: string | null; postal_address?: string | null } | null | undefined): boolean {
  return Boolean(org?.legal_name?.trim()) && postalAddressComplete(org?.postal_address);
}
