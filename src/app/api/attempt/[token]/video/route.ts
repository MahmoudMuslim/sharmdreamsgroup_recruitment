import { getSupabaseServiceClient } from "@/lib/data-api/service";
import { getFileStore } from "@/lib/files/store";
import { oversizeUploadResponse } from "@/lib/files/upload-guard";
import { supabaseConfig } from "@/lib/config";
import { NextResponse } from "next/server";

/** The one ceiling this route enforces, in two places: before the body is
 *  buffered (`oversizeUploadResponse`) and after, on the real file size. */
const VIDEO_MAX_MB = 50;
const VIDEO_MAX_BYTES = VIDEO_MAX_MB * 1024 * 1024;
const VIDEO_TOO_LARGE = `Video exceeds the ${VIDEO_MAX_MB}MB limit`;

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  // Before `formData()`: nginx lets 52 MB reach Node (docker/nginx/nginx.conf),
  // and this is the only door on the branch whose own ceiling is that close to it.
  const oversize = oversizeUploadResponse(request, VIDEO_MAX_BYTES, VIDEO_TOO_LARGE);
  if (oversize) return oversize;

  const { token } = await params;
  const questionId = new URL(request.url).searchParams.get("questionId");
  if (!questionId) {
    return NextResponse.json({ error: "questionId is required" }, { status: 400 });
  }

  const formData = await request.formData().catch(() => null);
  const video = formData?.get("video");
  if (!video || !(video instanceof Blob)) {
    return NextResponse.json({ error: "Video file is required" }, { status: 400 });
  }
  if (video.size > VIDEO_MAX_BYTES) {
    return NextResponse.json({ error: VIDEO_TOO_LARGE }, { status: 413 });
  }

  const supabase = getSupabaseServiceClient();
  const { data: attempt, error } = await supabase
    .from("candidate_attempts")
    .select("id, status")
    .eq("access_token", token)
    .single();

  if (error || !attempt) {
    return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  }
  if (attempt.status === "SUBMITTED" || attempt.status === "GRADED" || attempt.status === "EXPIRED") {
    return NextResponse.json({ error: "Assessment is closed" }, { status: 409 });
  }

  const extension = video.type.includes("mp4") ? "mp4" : "webm";
  const path = `${token}/${questionId}-${Date.now()}.${extension}`;

  const files = await getFileStore();
  const { error: uploadError } = await files.upload({
    bucket: supabaseConfig.buckets.candidateVideos,
    path,
    body: video,
    contentType: video.type || "video/webm",
    upsert: true,
  });

  if (uploadError) {
    return NextResponse.json({ error: "Video upload failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, path });
}
