import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { sessions } from "@shared/schema";
import { HttpError } from "@/lib/http";

export const SESSION_COOKIE = "notes_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365;
export function hashToken(token: string) { return createHash("sha256").update(token).digest("hex"); }
export function newToken() { return randomBytes(32).toString("hex"); }

async function ownerForToken(token: string | undefined): Promise<string | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const [session] = await db.select({ id: sessions.id }).from(sessions)
    .where(and(eq(sessions.token_hash, hashToken(token)), gt(sessions.expires_at, new Date()))).limit(1);
  return session?.id || null;
}

export async function getSessionOwner(): Promise<string | null> {
  return ownerForToken((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function requireSession(request?: NextRequest): Promise<string> {
  const owner = request ? await ownerForToken(request.cookies.get(SESSION_COOKIE)?.value) : await getSessionOwner();
  if (!owner) throw new HttpError(401, "Your session has expired. Reload to start a new session.");
  return owner;
}

/** A cookie never authorizes a mutation from another website. */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = process.env.APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
  try {
    if (!origin || origin !== new URL(origin).origin || new URL(origin).origin !== new URL(expected).origin) throw new Error("Origin mismatch");
  } catch {
    throw new HttpError(403, "This request must come from this website");
  }
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "Cross-site requests are not allowed");
}

export async function establishSession(request: NextRequest, response: NextResponse) {
  const existing = request.cookies.get(SESSION_COOKIE)?.value;
  const owner = await ownerForToken(existing);
  const expires = new Date(Date.now() + SESSION_MAX_AGE * 1000);
  let token: string;
  if (owner && existing) {
    token = existing;
    await db.update(sessions).set({ expires_at: expires }).where(eq(sessions.id, owner));
  } else {
    token = newToken();
    await db.insert(sessions).values({ token_hash: hashToken(token), expires_at: expires });
  }
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(process.env.APP_ORIGIN || process.env.NEXT_PUBLIC_SITE_URL || request.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}
