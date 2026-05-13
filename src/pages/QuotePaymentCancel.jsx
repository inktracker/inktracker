import { useSearchParams } from "react-router-dom";
import { XCircle } from "lucide-react";

export default function QuotePaymentCancel() {
  const [searchParams] = useSearchParams();
  const quoteId = searchParams.get("quote_id");
  // /quotepayment refuses to load without a valid public_token, so the
  // "Return to Quote" link MUST carry it. createCheckoutSession includes
  // both in the Stripe cancel_url.
  const token = searchParams.get("token");
  const returnHref = quoteId && token
    ? `/quotepayment?id=${encodeURIComponent(quoteId)}&token=${encodeURIComponent(token)}`
    : null;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-10 max-w-md w-full text-center">
        <XCircle className="w-12 h-12 text-slate-400 mx-auto mb-5" />
        <h1 className="text-xl font-bold text-slate-900 mb-2">Payment Cancelled</h1>
        <p className="text-slate-500 text-sm mb-7">
          Your payment was not processed and no charges were made. You can go back and try again.
        </p>
        {returnHref && (
          <a
            href={returnHref}
            className="block w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl transition text-sm mb-3"
          >
            Return to Quote
          </a>
        )}
        <p className="text-xs text-slate-400">If you need help, please contact the shop directly.</p>
      </div>
    </div>
  );
}