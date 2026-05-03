import { useState, useCallback } from "react";
import { searchCatalog, SUPPLIERS } from "@/api/suppliers";
import { fmtMoney } from "../components/shared/pricing";
import { Search, Package, ChevronRight, X, AlertCircle, Loader2, ShoppingCart } from "lucide-react";

const CATEGORIES = [
  { label: "All", value: "" },
  { label: "T-Shirts", value: "T-Shirts" },
  { label: "Sweatshirts", value: "Sweatshirts" },
  { label: "Hoodies", value: "Hoodies" },
  { label: "Fleece", value: "Fleece" },
  { label: "Polos", value: "Polos" },
  { label: "Hats", value: "Headwear" },
  { label: "Bags", value: "Bags" },
  { label: "Activewear", value: "Activewear" },
  { label: "Outerwear", value: "Outerwear" },
];

const SIZES = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"];

function StockBadge({ qty }) {
  if (qty == null) return null;
  const n = Number(qty);
  if (n === 0) return <span className="text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">Out</span>;
  if (n < 24) return <span className="text-xs font-semibold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">Low</span>;
  return <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">In Stock</span>;
}

function ProductCard({ product, onClick }) {
  const minPrice = product.piecePrice;
  const colorCount = product.colorCount ?? product.colors?.length ?? 0;

  return (
    <button
      onClick={() => onClick(product)}
      className="bg-white border border-slate-200 rounded-2xl p-4 text-left hover:border-indigo-300 hover:shadow-md transition group w-full"
    >
      {/* Image placeholder */}
      <div className="aspect-square bg-slate-100 rounded-xl mb-3 flex items-center justify-center overflow-hidden group-hover:bg-slate-50 transition">
        {product.imageUrl ? (
          <img src={product.imageUrl} alt={product.title} className="w-full h-full object-contain p-2" />
        ) : (
          <Package className="w-12 h-12 text-slate-300" />
        )}
      </div>

      <div className="space-y-1">
        <div className="text-xs font-bold text-indigo-600 uppercase tracking-wider">{product.brandName}</div>
        <div className="text-sm font-bold text-slate-800 leading-tight line-clamp-2">{product.title || product.styleNumber}</div>
        <div className="text-xs text-slate-400 font-mono">{product.styleNumber}</div>
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
        <div>
          <div className="text-base font-bold text-slate-900">
            {minPrice > 0 ? `From ${fmtMoney(minPrice)}` : "—"}
          </div>
          <div className="text-xs text-slate-400">{colorCount} color{colorCount !== 1 ? "s" : ""}</div>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-indigo-400 transition" />
      </div>
    </button>
  );
}

function ProductDetailPanel({ product, onClose, onAddToQuote }) {
  const [selectedColor, setSelectedColor] = useState(product.colors?.[0]?.colorName ?? "");

  const color = product.colors?.find((c) => c.colorName === selectedColor) ?? product.colors?.[0];
  const sizes = color?.sizeQuantities ?? {};
  const priceEntry = product.priceMap?.[selectedColor] ?? {};
  const piecePrice = priceEntry.piecePrice ?? color?.piecePrice ?? 0;
  const casePrice = priceEntry.casePrice ?? color?.casePrice ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-slate-200 bg-slate-50 sticky top-0 z-10">
          <div>
            <div className="text-xs font-bold text-indigo-600 uppercase tracking-wider">{product.brandName}</div>
            <h2 className="text-lg font-bold text-slate-900 leading-tight mt-0.5">{product.title || product.styleNumber}</h2>
            <div className="text-xs text-slate-400 font-mono mt-0.5">{product.styleNumber}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-200 transition ml-4 flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 flex-1">
          {/* Color picker */}
          {product.colors?.length > 0 && (
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">
                Color — <span className="text-slate-700 normal-case font-semibold">{selectedColor}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {product.colors.map((c) => (
                  <button
                    key={c.colorName}
                    onClick={() => setSelectedColor(c.colorName)}
                    title={c.colorName}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
                      selectedColor === c.colorName
                        ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                        : "border-slate-200 text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    {c.colorName}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Pricing */}
          <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Dealer Pricing</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-slate-500">Per Piece</div>
                <div className="text-2xl font-bold text-slate-900">{piecePrice > 0 ? fmtMoney(piecePrice) : "—"}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Case Price</div>
                <div className="text-2xl font-bold text-slate-900">{casePrice > 0 ? fmtMoney(casePrice) : "—"}</div>
              </div>
            </div>
          </div>

          {/* Inventory by size */}
          {Object.keys(sizes).length > 0 && (
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Inventory — {selectedColor}</div>
              <div className="grid grid-cols-4 gap-2">
                {SIZES.filter((s) => sizes[s] != null).map((size) => {
                  const qty = Number(sizes[size] ?? 0);
                  return (
                    <div key={size} className="bg-slate-50 border border-slate-200 rounded-xl p-2 text-center">
                      <div className="text-xs font-bold text-slate-500">{size}</div>
                      <div className={`text-sm font-bold mt-0.5 ${qty === 0 ? "text-red-500" : qty < 24 ? "text-orange-500" : "text-slate-800"}`}>
                        {qty.toLocaleString()}
                      </div>
                      <StockBadge qty={qty} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Description */}
          {product.description && (
            <div>
              <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Description</div>
              <p className="text-sm text-slate-600 leading-relaxed">{product.description}</p>
            </div>
          )}
        </div>

        {/* Footer action */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50">
          <button
            onClick={() => onAddToQuote({ product, selectedColor, piecePrice, casePrice })}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl transition flex items-center justify-center gap-2"
          >
            <ShoppingCart className="w-4 h-4" />
            Use in Quote
          </button>
          <p className="text-xs text-slate-400 text-center mt-2">
            Opens Quote Builder with this style pre-filled
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Catalog() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [supplier, setSupplier] = useState(SUPPLIERS.SS);
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);

  const search = useCallback(async (q = query, cat = category, sup = supplier) => {
    setLoading(true);
    setError("");
    setHasSearched(true);

    try {
      const data = await searchCatalog(sup, { query: q.trim(), category: cat, limit: 48, page: 1 });
      setProducts(data?.products ?? []);
      setTotal(data?.total ?? 0);
    } catch (err) {
      setError(err.message || "Failed to load catalog. Check your connection.");
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [query, category, supplier]);

  function handleSupplierChange(sup) {
    setSupplier(sup);
    setProducts([]);
    setTotal(0);
    setHasSearched(false);
    if (query || category) search(query, category, sup);
  }

  function handleCategoryClick(cat) {
    setCategory(cat);
    search(query, cat);
  }

  function handleAddToQuote({ product, selectedColor, piecePrice }) {
    // Store in sessionStorage so Quotes page can read it and open a pre-filled editor
    sessionStorage.setItem("ss_prefill", JSON.stringify({
      style: product.styleNumber ?? product.styleCode,
      brand: product.brandName ?? (supplier === SUPPLIERS.AC ? "AS Colour" : ""),
      garmentColor: selectedColor,
      garmentCost: piecePrice,
      styleName: product.title,
      resolvedStyleNumber: product.styleNumber ?? product.styleCode,
      supplierStyleNumber: product.styleNumber ?? product.styleCode,
      productNumber: product.id,
      resolvedTitle: product.title,
      supplier,
      inventoryMap: product.inventoryMap,
      priceMap: product.priceMap,
      colors: product.colors,
    }));
    // Navigate to Quotes with a flag
    window.location.href = "/Quotes?from_catalog=1";
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{supplier} Catalog</h1>
          <p className="text-sm text-slate-500 mt-1">Live dealer pricing and real-time inventory</p>
        </div>
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
          {[SUPPLIERS.SS, SUPPLIERS.AC].map((s) => (
            <button
              key={s}
              onClick={() => handleSupplierChange(s)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition ${
                supplier === s
                  ? "bg-indigo-600 text-white"
                  : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Search bar */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Search by style number, name, or brand… (e.g. 5000, G500, PC61)"
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white"
          />
        </div>
        <button
          onClick={() => search()}
          disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-semibold px-5 py-2.5 rounded-xl transition flex items-center gap-2"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Search
        </button>
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => handleCategoryClick(cat.value)}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition ${
              category === cat.value
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-red-800">Could not reach S&S catalog</div>
            <div className="text-xs text-red-600 mt-0.5">{error}</div>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4 animate-pulse">
              <div className="aspect-square bg-slate-100 rounded-xl mb-3" />
              <div className="h-3 bg-slate-100 rounded mb-2 w-1/2" />
              <div className="h-4 bg-slate-100 rounded mb-1" />
              <div className="h-3 bg-slate-100 rounded w-2/3" />
            </div>
          ))}
        </div>
      )}

      {/* Results */}
      {!loading && products.length > 0 && (
        <>
          <div className="text-xs text-slate-400 font-semibold">
            {total > products.length ? `Showing ${products.length} of ${total.toLocaleString()} products` : `${products.length} product${products.length !== 1 ? "s" : ""}`}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {products.map((p) => (
              <ProductCard key={p.id || p.styleNumber} product={p} onClick={setSelectedProduct} />
            ))}
          </div>
        </>
      )}

      {/* Empty state */}
      {!loading && hasSearched && products.length === 0 && !error && (
        <div className="text-center py-20">
          <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <div className="text-slate-500 font-semibold">No products found</div>
          <div className="text-sm text-slate-400 mt-1">Try a different style number or category</div>
        </div>
      )}

      {/* Prompt to search */}
      {!loading && !hasSearched && (
        <div className="text-center py-20 border-2 border-dashed border-slate-200 rounded-3xl">
          <Search className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <div className="text-slate-500 font-semibold">Search the S&S catalog</div>
          <div className="text-sm text-slate-400 mt-1">
            Enter a style number (e.g. <span className="font-mono">5000</span>, <span className="font-mono">PC61</span>), brand, or pick a category above
          </div>
        </div>
      )}

      {/* Product detail panel */}
      {selectedProduct && (
        <ProductDetailPanel
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onAddToQuote={handleAddToQuote}
        />
      )}
    </div>
  );
}
