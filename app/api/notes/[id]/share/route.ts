import { NextRequest, NextResponse } from "next/server";
import { createShare, revokeShares } from "@/lib/db";
import { assertSameOrigin, requireSession } from "@/lib/auth";
import { errorResponse, privateHeaders, requireUuid } from "@/lib/http";
import { revalidatePath } from "next/cache";

type Context = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, { params }: Context) {
  try {
    assertSameOrigin(request);
    const owner = await requireSession(request);
    const token = await createShare(requireUuid((await params).id), owner);
    const url = new URL(`/shared/${token}`, process.env.APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || request.url).toString();
    return NextResponse.json({ url }, { status: 201, headers: privateHeaders });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    assertSameOrigin(request);
    const owner = await requireSession(request);
    await revokeShares(requireUuid((await params).id), owner);
    revalidatePath("/shared/[token]", "page");
    return NextResponse.json({ success: true }, { headers: privateHeaders });
  } catch (error) { return errorResponse(error); }
}
