import { useToast } from "@/components/ui/use-toast";
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";

export function Toaster() {
  const { toasts } = useToast();

  // Filter out dismissed toasts so they leave the DOM immediately on
  // close. The reducer's REMOVE happens after TOAST_REMOVE_DELAY (kept
  // small post-fix); this gate is what makes the X click feel instant.
  const visible = toasts.filter((t) => t.open !== false);

  return (
    <ToastProvider>
      {visible.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose toastId={id} />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
} 