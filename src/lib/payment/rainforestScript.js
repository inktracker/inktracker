// Load Rainforest's web-component script (payment form / merchant sign-up)
// once per page. Only Rainforest's own static host is ever loaded, even if a
// server response said otherwise.

const ALLOWED = /^https:\/\/static\.rainforestpay\.com\/(sandbox\.)?(payment|merchant)\.js$/;
const loading = new Map();

export function isAllowedRainforestScript(url) {
  return ALLOWED.test(String(url || ""));
}

export function loadRainforestScript(url) {
  if (!isAllowedRainforestScript(url)) return Promise.reject(new Error("Unexpected payment script"));
  if (loading.has(url)) return loading.get(url);
  const p = new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.type = "module";
    el.src = url;
    el.onload = () => resolve();
    el.onerror = () => { loading.delete(url); reject(new Error("Couldn't load the payment form")); };
    document.head.appendChild(el);
  });
  loading.set(url, p);
  return p;
}
