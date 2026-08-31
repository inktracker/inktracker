import{r as i,j as s}from"./react-vendor-FHKGplNL.js";import{ao as w,J as j,C as v,b as m,s as d}from"./index-BEVDEnTo.js";import{O as N}from"./OrderWizard-LcwFS2xQ.js";import{E as _}from"./EmbedSnippets-CPK1fDWg.js";import"./supabase-vendor-CQr2cQj-.js";import"./uploadFile-JwLVJbUA.js";import"./Icon-B-Y3qHKS.js";import"./publicUrls-DGpBc8U-.js";function I(){const[u,h]=i.useState(null),[n,p]=i.useState(""),[x,l]=i.useState(""),[c,b]=i.useState(!1);i.useEffect(()=>{async function e(){var o;try{const t=await m.auth.me();if(!(t!=null&&t.email))return;p(t.email),t.shop_name&&l(t.shop_name);const r=await m.entities.Shop.filter({owner_email:t.email}),a=r==null?void 0:r[0];a!=null&&a.shop_name&&!t.shop_name&&l(a.shop_name),(o=a==null?void 0:a.wizard_styles)!=null&&o.length&&h(a.wizard_styles)}catch{}}e()},[]);async function f(e){await m.entities.Quote.create({...e,shop_owner:n,source:"wizard"});try{const o=(e.line_items||[]).map(r=>`${r.style} · ${r.garmentColor} (${Object.values(r.sizes||{}).reduce((a,y)=>a+(parseInt(y)||0),0)} pcs)`).join(`
`),t=x||"Your Shop";await d.functions.invoke("sendQuoteEmail",{body:{customerEmails:[n],customerName:e.customer_name||"Customer",quoteId:e.quote_id,shopName:t,subject:`New Quote Request from ${e.customer_name||"a customer"}`,body:`A new quote request has been submitted through the order wizard.

Customer: ${e.customer_name}
Email: ${e.customer_email||"—"}
Phone: ${e.phone||"—"}
Company: ${e.company||"—"}

Items:
${o}

Log in to InkTracker to review and send a quote.`}}),e.customer_email&&await d.functions.invoke("sendQuoteEmail",{body:{customerEmails:[e.customer_email],customerName:e.customer_name||"Customer",quoteId:e.quote_id,shopName:t,subject:`We received your quote request — ${t}`,body:`Hi ${e.customer_name||"there"},

Thank you for your order request! We've received it and will follow up within 1 business day with a finalized quote.

Items requested:
${o}

If you have any questions, just reply to this email.`}})}catch(o){console.error("[Wizard] email notification failed:",o==null?void 0:o.message)}}return s.jsxs("div",{className:"space-y-6",children:[s.jsxs("div",{children:[s.jsx("h2",{className:"text-2xl font-bold text-slate-900",children:"Order Wizard"}),s.jsx("p",{className:"text-slate-500 text-sm mt-1",children:"Step-by-step quote builder for walk-in or phone customers"})]}),s.jsx(N,{onSubmit:f,styles:u,shopOwner:n}),s.jsxs("div",{className:"bg-white border border-slate-100 rounded-2xl overflow-hidden",children:[s.jsxs("button",{onClick:()=>b(e=>!e),className:"w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50 transition",children:[s.jsxs("div",{className:"flex items-center gap-3",children:[s.jsx(w,{className:"w-5 h-5 text-slate-500"}),s.jsxs("div",{children:[s.jsx("div",{className:"font-bold text-slate-800",children:"Embed on your website"}),s.jsx("div",{className:"text-xs text-slate-500 mt-0.5",children:"Paste a snippet on Wix, Squarespace, or any website — customers submit quote requests directly to your Quotes page."})]})]}),c?s.jsx(j,{className:"w-5 h-5 text-slate-500"}):s.jsx(v,{className:"w-5 h-5 text-slate-500"})]}),c&&s.jsx("div",{className:"px-5 pb-5 border-t border-slate-100",children:s.jsx("div",{className:"pt-5",children:s.jsx(_,{})})})]})]})}export{I as default};
