// Shown when a signed-out visitor lands on a page that needs an account.
//
// These routes sit in PUBLIC_PATHS (so they bypass the role-based redirects),
// which means an anonymous visitor reaches them and the page's `if (!user)`
// guard used to `return null` — a blank white screen with no spinner, no
// message, and no way forward. A dead-end blank page reads exactly as broken
// as an error code does, so every guard renders this instead.

import { LogIn } from "lucide-react";

export default function SignInRequired({
  title = "Sign in to continue",
  message = "This page needs an account. Sign in and we'll bring you right back here.",
}) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 max-w-md w-full text-center space-y-5">
        <div className="flex items-center justify-center w-14 h-14 bg-teal-50 rounded-full mx-auto">
          <LogIn className="w-7 h-7 text-teal-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">{message}</p>
        </div>
        <a
          href="/"
          className="inline-flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white font-semibold px-5 py-2.5 rounded-xl transition text-sm"
        >
          <LogIn className="w-4 h-4" /> Go to sign in
        </a>
      </div>
    </div>
  );
}
