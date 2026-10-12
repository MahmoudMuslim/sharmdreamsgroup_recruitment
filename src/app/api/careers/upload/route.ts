import { getSupabaseAnonClient } from "@/lib/supabase/anon";

/**
 * Public CV upload endpoint.
 *
 * Separate from the application action because the file has to travel as
 * multipart form data, which a Server Action's serialised arguments do not
 * carry. The two-step flow (upload, then submit) means an orphaned file is
 * possible if the second step fails; that is preferable to losing the file
 * entirely, and orphans are invisible to staff until an application references
 * them.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Could not read the upload." }, { status: 400 });
  }

  const fileEntry = form.get("file");
  const jobId = form.get("jobId");

  console.log("[upload] received file:", fileEntry instanceof File, fileEntry instanceof File ? fileEntry.size : "N/A", "bytes, type:", fileEntry instanceof File ? fileEntry.type : "N/A");
  console.log("[upload] jobId:", jobId);

  if (!(fileEntry instanceof File) || fileEntry.size === 0) {
    return Response.json({ error: "No file was attached." }, { status: 400 });
  }

  if (typeof jobId !== "string" || !jobId) {
    return Response.json({ error: "Missing job reference." }, { status: 400 });
  }

  // Re-validated server-side: a client MIME type proves nothing.
  if (!ALLOWED_TYPES.has(fileEntry.type)) {
    return Response.json(
      { error: "Attach a PDF, Word document or plain-text CV." },
      { status: 415 }
    );
  }

  if (fileEntry.size > MAX_BYTES) {
    return Response.json(
      { error: "That file is larger than 5 MB." },
      { status: 413 }
    );
  }

  const supabase = getSupabaseAnonClient();

  // Only open roles accept applications, so an upload for a draft or closed
  // role is rejected here rather than after the file is already stored.
  const { data: job } = await supabase
    .from("job_openings")
    .select("id")
    .eq("id", jobId)
    .eq("status", "PUBLISHED")
    .maybeSingle();

  if (!job) {
    return Response.json(
      { error: "This role is no longer accepting applications." },
      { status: 404 }
    );
  }

  // The stored name never includes the client's path — only a sanitised leaf.
  const leaf = fileEntry.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "cv";
  const path = `applications/${jobId}/${crypto.randomUUID()}-${leaf}`;

  const { error } = await supabase.storage
    .from("candidate-cvs")
    .upload(path, fileEntry, { contentType: fileEntry.type, upsert: false });

  if (error) {
    return Response.json(
      { error: "We could not attach your CV. Try pasting your CV text instead." },
      { status: 500 }
    );
  }

  return Response.json({ path });
}