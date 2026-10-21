import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { getFileStore } from "@/lib/files/store";
import { supabaseConfig } from "@/lib/config";
import { NextResponse } from "next/server";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
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
  if (video.size > 50 * 1024 * 1024) {
    return NextResponse.json({ error: "Video exceeds the 50MB limit" }, { status: 413 });
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
