import { createHash, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { noteCourierComment, syncShipmentByTrackingCode } from "@/lib/courierSync";

const digest = (value: string) => createHash("sha256").update(value).digest();

function isValidSecret(secret: string) {
  const expected = process.env.UPAYA_WEBHOOK_SECRET;
  return Boolean(expected) && timingSafeEqual(digest(secret), digest(expected as string));
}

export async function POST(request: Request, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  if (!isValidSecret(secret)) return new NextResponse(null, { status: 404 });

  const event = await request.json().catch(() => null);
  const isTest = request.headers.get("x-upaya-test") === "true" || Boolean(event?.test);

  if (!isTest && event?.update_type === "order_status" && typeof event.tracking_code === "string") {
    const trackingCode: string = event.tracking_code;
    // Upaya expects a reply within 10 seconds, so the lookup runs after it.
    after(() => syncShipmentByTrackingCode(trackingCode).catch(err => {
      console.error("[upaya] webhook sync failed", trackingCode, err);
    }));
  }

  if (!isTest && event?.update_type === "comment" && typeof event.tracking_code === "string" && typeof event.comment === "string") {
    const trackingCode: string = event.tracking_code;
    const comment: string = event.comment;
    const by = typeof event.commented_by === "string" ? event.commented_by : null;
    const at = typeof event.commented_at === "string" ? event.commented_at : null;
    after(() => noteCourierComment(trackingCode, comment, by, at).catch(err => {
      console.error("[upaya] webhook comment failed", trackingCode, err);
    }));
  }

  return NextResponse.json({ ok: true });
}
