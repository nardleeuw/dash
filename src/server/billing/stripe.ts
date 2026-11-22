import "server-only";
import Stripe from "stripe";
import { env } from "@/server/env";
import { providerMode } from "@/server/providers/mode";

let client: Stripe | null = null;

export function stripeMode() {
  return providerMode("stripe");
}

export function stripe(): Stripe {
  const key = env().STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe is not configured");
  if (!client) client = new Stripe(key, { maxNetworkRetries: 2, appInfo: { name: "Leadwerk" } });
  return client;
}
