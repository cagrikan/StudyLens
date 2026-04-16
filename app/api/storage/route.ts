import { NextRequest, NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  const value = await redis.get(key);
  if (value === null) return NextResponse.json({ value: null });
  
  const strValue = typeof value === "string" ? value : JSON.stringify(value);
  return NextResponse.json({ value: strValue });
}

export async function POST(req: NextRequest) {
  const { key, value } = await req.json();
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  await redis.set(key, value);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });

  await redis.del(key);
  return NextResponse.json({ ok: true });
}