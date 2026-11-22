import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth";
import { searchLocations } from "@/server/providers/pdok/client";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = request.nextUrl.searchParams.get("q") ?? "";
  try {
    const results = await searchLocations(q);
    return NextResponse.json({ results }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch {
    return NextResponse.json({ results: [], error: "unavailable" }, { status: 200 });
  }
}
