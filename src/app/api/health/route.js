import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json({ status: "ok", version: "v6.x" });
}
