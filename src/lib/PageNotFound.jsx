import { useLocation } from 'react-router-dom';

export default function PageNotFound() {
    const location = useLocation();
    const pageName = location.pathname.replace(/^\//, "");

    return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
            <div className="max-w-md w-full">
                <div className="text-center space-y-6">
                    <div className="space-y-2">
                        <h1 className="text-7xl font-light text-slate-300">404</h1>
                        <div className="h-0.5 w-16 bg-slate-200 mx-auto"></div>
                    </div>

                    <div className="space-y-3">
                        <h2 className="text-2xl font-medium text-slate-800">
                            Page not found
                        </h2>
                        <p className="text-slate-600 leading-relaxed">
                            {pageName
                                ? <>We couldn't find <span className="font-medium text-slate-700">"/{pageName}"</span>. The link may be wrong, or the page may have moved.</>
                                : "We couldn't find that page. The link may be wrong, or the page may have moved."}
                        </p>
                    </div>

                    <div className="pt-2 space-y-3">
                        <button
                            onClick={() => window.location.href = '/'}
                            className="inline-flex items-center px-5 py-2.5 text-sm font-semibold text-white bg-teal-600 rounded-xl hover:bg-teal-700 transition"
                        >
                            Back to InkTracker
                        </button>
                        <p className="text-xs text-slate-500">
                            Something broken? Email <a href="mailto:support@inktracker.app" className="text-teal-600 hover:text-teal-700 font-semibold">support@inktracker.app</a>.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
