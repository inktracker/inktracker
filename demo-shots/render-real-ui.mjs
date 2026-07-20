// Render REAL InkTracker UI screenshots with fabricated demo data (no client data).
//
// It boots the actual app, seeds a fake Supabase session, and intercepts every
// backend call (/auth, /rest, /functions) with the demo JSON below — so what
// gets screenshotted is the real React UI, not a mockup.
//
// ── Run it ──────────────────────────────────────────────────────────────────
//   1. Terminal A:  npm run dev            (leave it running; note the port)
//   2. Terminal B:  npm i -D playwright && npx playwright install chromium
//   3. Terminal B:  BASE=http://localhost:5173 node demo-shots/render-real-ui.mjs
//      (change 5173 if your dev server prints a different port)
//
// Output: demo-shots/app-*.png  (2x retina, full page)
//
// The Supabase project ref below must match VITE_SUPABASE_URL in your .env
// (the subdomain). It's used only to name the localStorage session key.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE || "http://localhost:5173";
const REF = process.env.SUPABASE_REF || "skmltfbibaqcjddmeqvi"; // subdomain of VITE_SUPABASE_URL

// ── Demo data (fictional shop — nothing real) ────────────────────────────────
const profile = { id:"demo-user-1", auth_id:"demo-user-1", email:"demo@summitridge.example", role:"shop", mfa_email_enabled:false, shop_name:"Summit Ridge Printing", subscription_tier:"shop", subscription_status:"active", trial_ends_at:null, shop_owner:"demo@summitridge.example", logo_url:null, assigned_shops:null, cancel_at_period_end:false, subscription_ends_at:null };
const user = { id:"demo-user-1", aud:"authenticated", role:"authenticated", email:profile.email, app_metadata:{provider:"email"}, user_metadata:{} };
const cust = (id,company)=>({ id, company, name:company, shop_owner:profile.email });
const customers = [cust("c1","North Vista Athletics"),cust("c2","Cedar & Oak Co."),cust("c3","Riverside FC"),cust("c4","Basin Brewing"),cust("c5","Highland Prep"),cust("c6","Lumen Fitness"),cust("c7","Tahoe Trail Co."),cust("c8","Mesa Ridge HS"),cust("c9","Delta Robotics"),cust("c10","Summit Cycles"),cust("c11","Ferngully Cafe")];
const li = [{ sizes:{ S:12, M:24, L:24, XL:12 } }];
const O = (order_id,cid,cname,status,total,due,press,comp)=>({ id:order_id, order_id, customer_id:cid, customer_name:cname, company:cname, status, total, due_date:due, assigned_press:press, completed_date:comp, line_items:li, paid:status==="Completed", created_date:"2026-07-01T10:00:00Z", shop_owner:profile.email });
const orders = [
  O("SR-1051","c1","North Vista Athletics","Art Approval",5400,"2026-07-09","Auto 1",null),
  O("SR-1049","c2","Cedar & Oak Co.","Art Approval",3120,"2026-07-10",null,null),
  O("SR-1047","c3","Riverside FC","Order Goods",6800,"2026-07-08",null,null),
  O("SR-1045","c4","Basin Brewing","Order Goods",2450,"2026-07-11","Auto 2",null),
  O("SR-1043","c5","Highland Prep","Pre-Press",7550,"2026-07-07","Auto 2",null),
  O("SR-1042","c6","Lumen Fitness","Pre-Press",4980,"2026-07-08",null,null),
  O("SR-1039","c7","Tahoe Trail Co.","Printing",14280,"2026-07-03","Auto 1",null),
  O("SR-1038","c8","Mesa Ridge HS","Printing",6120,"2026-07-05","Manual",null),
  O("SR-1036","c9","Delta Robotics","Printing",8640,"2026-07-06","Auto 2",null),
  O("SR-1031","c10","Summit Cycles","Completed",3910,"2026-07-01","Auto 1","2026-07-01T12:00:00Z"),
  O("SR-1029","c11","Ferngully Cafe","Completed",2475,"2026-06-30",null,"2026-06-30T12:00:00Z"),
  O("SR-1027","c8","Mesa Ridge HS","Completed",5200,"2026-06-29","Auto 1","2026-06-29T12:00:00Z")];
const Q = (quote_id,cid,cname,status,total,date)=>({ id:quote_id, quote_id, customer_id:cid, customer_name:cname, status, total, date, created_date:date+"T10:00:00Z", shop_owner:profile.email });
const quotes = [Q("Q-2087","c1","North Vista Athletics","Pending",4200,"2026-07-02"),Q("Q-2086","c2","Cedar & Oak Co.","Approved",3120,"2026-07-02"),Q("Q-2084","c3","Riverside FC","Approved",6800,"2026-07-01"),Q("Q-2082","c4","Basin Brewing","Draft",2450,"2026-06-30"),Q("Q-2081","c5","Highland Prep","Pending",7550,"2026-06-30"),Q("Q-2079","c6","Lumen Fitness","Approved",5400,"2026-06-28")];
const I = (invoice_id,cid,cname,date,total,paid,qb)=>({ id:invoice_id, invoice_id, customer_id:cid, customer_name:cname, date, total, paid, qb_invoice_id:qb, qb_doc_number:qb, shop_owner:profile.email });
const invoices = [I("INV-2071","c7","Tahoe Trail Co.","2026-07-02",14280,false,"1042"),I("INV-2069","c9","Delta Robotics","2026-07-01",8640,false,"1041"),I("INV-2066","c10","Summit Cycles","2026-06-30",3910,true,"1039"),I("INV-2064","c8","Mesa Ridge HS","2026-06-29",6120,false,"1038"),I("INV-2061","c11","Ferngully Cafe","2026-06-27",2475,true,"1036"),I("INV-2058","c4","Basin Brewing","2026-06-25",5340,true,"1034"),I("INV-2055","c5","Highland Prep","2026-06-24",9180,false,"1032")];
const inventory = [{id:"i1",item:"Gildan 5000 · Black",sku:"G5000-BLK-L",qty:42,reorder:120,unit:"pcs",shop_owner:profile.email},{id:"i2",item:"Bella+Canvas 3001 · White",sku:"BC3001-WHT-M",qty:65,reorder:150,unit:"pcs",shop_owner:profile.email},{id:"i3",item:"AS Colour 5001 · Grey Marle",sku:"AS5001-GRM-L",qty:28,reorder:96,unit:"pcs",shop_owner:profile.email},{id:"i4",item:"Next Level 6210 · Navy",sku:"NL6210-NVY-XL",qty:51,reorder:100,unit:"pcs",shop_owner:profile.email}];
const perfRecords = ["01","02","03","04","05","06","07","08","09","10","11","12"].map((m,i)=>({ id:"p"+m, date:"2026-"+m+"-15", total:[52,58,64,61,69,74,71,66,72,78,83,80][i]*1000, order_id:"H-"+m, units:[3800,4200,4600,4400,5000,5300,5100,4800,5200,5600,6000,5800][i] }));
const dashStats = { active_quotes_count:38, active_quotes_value:84320, open_orders_count:21, open_orders_unpaid_value:63910, open_invoices_count:12, open_invoices_value:41275, revenue_30d:72480, units_30d:6240, customer_count:214 };
const perfStats = { period_orders_count:1284, period_gross_sales:812450, period_units:52840, active_orders_count:21, active_orders_value:63910, outstanding_total:41275, outstanding_count:12, open_invoices_total:41275, open_invoices_count:12 };
const qbMetrics = { connected:true, openInvoicesCount:12, openInvoicesTotal:41275, revenueLast30Days:72480, revenueOrderCount:96, asOf:Date.now() };

function tableRows(url){
  if(url.includes("/rest/v1/quotes")) return quotes;
  if(url.includes("/rest/v1/orders")) return orders;
  if(url.includes("/rest/v1/invoices")) return invoices;
  if(url.includes("/rest/v1/inventory_items")) return inventory;
  if(url.includes("/rest/v1/customers")) return customers;
  if(url.includes("/rest/v1/shop_performance")) return perfRecords;
  return [];
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport:{ width:1440, height:900 }, deviceScaleFactor:2 });
await ctx.addInitScript((ref)=>{
  const n = Math.floor(Date.now()/1000);
  localStorage.setItem("sb-"+ref+"-auth-token", JSON.stringify({ access_token:"demo", token_type:"bearer", expires_in:36000, expires_at:n+36000, refresh_token:"demo", user:{ id:"demo-user-1", aud:"authenticated", role:"authenticated", email:"demo@summitridge.example", app_metadata:{provider:"email"}, user_metadata:{} } }));
}, REF);

await ctx.route("**/*",(route)=>{
  const req = route.request(); const url = req.url();
  const single = (req.headers()["accept"]||"").includes("vnd.pgrst.object");
  const j = (o)=>route.fulfill({ status:200, contentType:"application/json", headers:{ "Access-Control-Allow-Origin":"*" }, body:JSON.stringify(o) });
  if(/sentry\.io|ingest\./.test(url)) return route.abort();
  if(url.includes("/auth/v1/user")) return j(user);
  if(url.includes("/auth/v1/token")) return j({ access_token:"demo", token_type:"bearer", expires_in:36000, expires_at:Math.floor(Date.now()/1000)+36000, refresh_token:"demo", user });
  if(url.includes("/auth/v1/")) return j({});
  if(url.includes("/rest/v1/rpc/dashboard_stats")) return j(dashStats);
  if(url.includes("/rest/v1/rpc/performance_stats")) return j(perfStats);
  if(url.includes("/rest/v1/rpc/")) return j({});
  if(url.includes("/functions/v1/")){ let a=""; try{ a=(req.postDataJSON()||{}).action||""; }catch(e){} if(a==="getDashboardMetrics") return j(qbMetrics); if(a==="checkConnection") return j({connected:true}); return j({}); }
  if(url.includes("/rest/v1/profiles")) return single ? j(profile) : j([profile]);
  if(url.includes("/rest/v1/shops")) return j({ pricing_config:null, timezone:null, production_tasks:null });
  if(url.includes("/rest/v1/")){ const d = tableRows(url); return single ? j(d[0]||null) : j(d); }
  return route.continue();
});

const pages = [["Dashboard","app-01-dashboard"],["Production","app-02-production"],["Invoices","app-03-invoices"],["Performance","app-04-performance"]];
const page = await ctx.newPage();
await page.goto(BASE+"/Dashboard", { waitUntil:"networkidle", timeout:60000 }).catch(()=>{});
await page.waitForTimeout(2500);
for(const [route,name] of pages){
  await page.goto(BASE+"/"+route, { waitUntil:"networkidle", timeout:60000 }).catch(()=>{});
  await page.waitForTimeout(2500);
  await page.screenshot({ path:join(OUT,name+".png"), fullPage:true });
  console.log("shot", name);
}
await browser.close();
console.log("Done — screenshots in demo-shots/");
