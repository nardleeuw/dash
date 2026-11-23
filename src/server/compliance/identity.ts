/**
 * Sender identity shown under every email: the sender's (company) name. No
 * postal address and no KVK number are stored or shown. One rule for every
 * send path (send runs, inbox replies, overview checklist). Pure — unit tested.
 */
export function senderIdentityComplete(org: { legal_name?: string | null } | null | undefined): boolean {
  return Boolean(org?.legal_name?.trim());
}
