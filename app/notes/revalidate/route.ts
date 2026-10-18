import { NextResponse } from "next/server";

/** Mutations now invalidate their own content after authorization. */
export async function POST() {
  return NextResponse.json({ error: "This endpoint is retired. Notes refresh automatically after saving." }, {
    status: 410, headers: { "Cache-Control": "no-store" },
  });
}
