import { NextResponse, type NextRequest } from "next/server";
import { stripe } from "@/server/billing/stripe";
import { handleStripeEvent } from "@/server/billing/service";

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !process.env.STRIPE_SECRET_KEY) return NextResponse.json({ error: "not_configured" }, { status: 501 });
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  const body = await req.text();
  let event;
  try {
    event = stripe().webhooks.constructEvent(body, signature, secret);
  } catch {
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }
  try {
    const res = await handleStripeEvent(event);
    return NextResponse.json(res);
  } catch (err) {
    console.error("[stripe webhook]", err);
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
