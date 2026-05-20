import { toast } from "@/components/ui/use-toast";

function describeError(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (err.message) return err.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}

export const notify = {
  error(title, err) {
    const description = err ? describeError(err) : undefined;
    if (err) console.error(`[notify] ${title}:`, err);
    toast({ variant: "destructive", title, description });
  },
  success(title, description) {
    toast({ title, description });
  },
  info(title, description) {
    toast({ title, description });
  },
};
