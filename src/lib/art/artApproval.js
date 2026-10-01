// The frontend's view of artwork approval. Re-exports the ONE shared module
// the edge functions also use, so "what was approved" and "is it approved
// now" can't drift between the server and the screens.
export * from "../../../supabase/functions/_shared/artApproval.js";
