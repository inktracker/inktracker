import { supabase } from "@/api/supabaseClient";

const BUCKET = "artwork";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export async function uploadFile(file) {
  const ext = file.name?.split(".").pop() || "bin";
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false });

  if (error) throw error;

  const file_url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
  return { file_url };
}
