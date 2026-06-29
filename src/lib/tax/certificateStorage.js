import { base44, supabase } from "@/api/supabaseClient";
import { validateUploadCandidate } from "@/lib/uploadValidation";
import { shopScope } from "@/lib/shopScope";

// Tax-exemption certificates contain a tax ID, so unlike artwork they go in a
// PRIVATE bucket (public=false) — no public URL exists; access is signed-URL
// only. See migration 20260722000000_tax_certificates_bucket.sql.
const CERT_BUCKET = "tax-certificates";
const SIGNED_TTL = 60 * 60; // 1 hour — plenty for a viewing session

/**
 * Upload a certificate to the private bucket. Reuses the shared upload
 * validation (extension + 25 MB cap). Returns the bucket-relative `path`
 * (there is no public URL — view via signCertificateUrl). Throws on failure.
 */
export async function uploadCertificate(file) {
  const ext = validateUploadCandidate(file);
  // Tenant-scoped path: "<shop_owner>/<uuid>.<ext>". The first segment is the
  // shop owner's email (shopScope resolves it for owners AND team members), and
  // the bucket RLS (SEC-01, migration 20260728) requires that segment to be a
  // shop the caller belongs to — so one shop can't read another's certs even
  // with the path. UUID filename stays unguessable on top of that.
  const me = await base44.auth.me();
  const owner = shopScope(me);
  if (!owner) throw new Error("You must be signed in to upload a certificate.");
  const path = `${owner}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from(CERT_BUCKET)
    .upload(path, file, { upsert: false, cacheControl: "3600" });
  if (error) throw error;
  return { path };
}

/**
 * Mint a short-lived signed URL to view a stored certificate. Returns null when
 * the path is empty or signing fails, so the caller can leave the View action
 * inert rather than opening a broken link.
 */
export async function signCertificateUrl(path, expiresInSec = SIGNED_TTL) {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage
      .from(CERT_BUCKET)
      .createSignedUrl(path, expiresInSec);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}
