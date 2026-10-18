import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, establishSession, requireSession } from "@/lib/auth";
import { allowKeys, errorResponse, HttpError, privateHeaders, readOptionalJson } from "@/lib/http";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  try {
    await requireSession(request);
    return NextResponse.json({ authenticated: true }, { headers: privateHeaders });
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) return NextResponse.json({ authenticated: false }, { headers: privateHeaders });
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const body = await readOptionalJson(request, 1024);
    if (body) allowKeys(body, []);
    const response = NextResponse.json({ authenticated: true }, { headers: privateHeaders });
    await establishSession(request, response);
    return response;
  } catch (error) { return errorResponse(error); }
}
