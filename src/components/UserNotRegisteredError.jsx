import React from "react";
import { Clock3 } from "lucide-react";

export default function UserNotRegisteredError() {
  return (
    <div className="min-h-screen bg-[#F3EFE6] flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-xl bg-white rounded-3xl shadow-lg border border-slate-200 overflow-hidden">
        <div className="px-10 pt-10 pb-8 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
            <Clock3 className="h-8 w-8 text-amber-600" />
          </div>

          <h1 className="text-3xl font-bold text-slate-900">
            Thanks for applying
          </h1>

          <p className="text-base text-slate-600 mt-4 leading-7">
            Your account has been created successfully.
          </p>
        </div>

        <div className="px-8 pb-8">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-6">
            <p className="text-sm text-slate-700 leading-7">
              As soon as your account is approved, you will have access to
              InkTracker.
            </p>
          </div>

          <div className="mt-6 text-center">
            <p className="text-sm text-slate-500 leading-6">
              Once approved, return and sign in again using the same email
              address.
            </p>
          </div>

          <div className="mt-8">
            <a
              href="/"
              className="w-full inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-semibold py-3 px-4 transition"
            >
              Back to Homepage
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}