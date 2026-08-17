/**
 * The confirmation a shop sees after a quote email is genuinely delivered.
 *
 * This only renders once sendQuoteEmail has returned success — i.e. Resend
 * accepted the message — so the animation is a reliable signal, not decoration
 * over a hopeful status flag. (Before 2026-08-17 a quote could read "Sent"
 * with nothing emailed; that class of lie is what this screen exists to make
 * impossible to miss.)
 *
 * Motion lives in index.css (.sent-*) so `prefers-reduced-motion` can switch
 * all of it off in one place while the words stay identical.
 */
export default function QuoteSentConfirmation({ recipients = [], quoteId, onClose }) {
  const list = recipients.filter(Boolean);

  return (
    <div className="p-8 flex flex-col items-center gap-5 text-center">
      {/* Badge: expanding ring behind a check that draws itself. */}
      <div className="relative flex items-center justify-center w-20 h-20">
        <span
          aria-hidden="true"
          className="sent-ring absolute inset-0 rounded-full bg-emerald-400/30"
        />
        <span className="sent-pop relative flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/25">
          <svg viewBox="0 0 24 24" className="w-9 h-9" fill="none" aria-hidden="true">
            <path
              d="M5 12.5l4.5 4.5L19 7.5"
              className="sent-check"
              stroke="white"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>

      <div>
        <div className="sent-line sent-line-1 font-semibold text-slate-900 text-lg">
          Quote sent
        </div>
        <div className="sent-line sent-line-2 text-sm text-slate-500 mt-1.5">
          {list.length > 0 ? (
            <>
              Delivered to{" "}
              <span className="font-medium text-slate-700">{list.join(", ")}</span>
            </>
          ) : (
            "Your customer has it."
          )}
          {quoteId ? <span className="block text-slate-400 mt-0.5">{quoteId}</span> : null}
        </div>
      </div>

      <button
        onClick={onClose}
        className="mt-1 px-6 py-2 text-sm font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition"
      >
        Done
      </button>
    </div>
  );
}
