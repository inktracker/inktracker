// STEP 2: Contact Details. Extracted verbatim from OrderWizard.jsx as a
// pure structural move — contact state lives in the parent and is
// threaded in; no pricing or cost math here.
export default function DetailsStep({ bc, contact, setContact, setStep }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={()=>setStep(1)} className="text-slate-500 hover:text-slate-700 text-sm">← Back</button>
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200">Your details</h3>
      </div>
      <div className="bg-white rounded-2xl border border-slate-100 p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            {key:"name",label:"Full Name *",placeholder:"Jane Smith",type:"text"},
            {key:"company",label:"Company / Organization",placeholder:"School or business name",type:"text"},
            {key:"email",label:"Email *",placeholder:"jane@example.com",type:"email"},
            {key:"phone",label:"Phone",placeholder:"(775) 555-0000",type:"tel"},
          ].map(f=>(
            <div key={f.key}>
              <label htmlFor={`wiz-${f.key}`} className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{f.label}</label>
              <input id={`wiz-${f.key}`} type={f.type} value={contact[f.key]} onChange={e=>setContact(c=>({...c,[f.key]:e.target.value}))}
                placeholder={f.placeholder}
                className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="wiz-dueDate" className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">In-Hands Date</label>
            <input id="wiz-dueDate" type="date" value={contact.dueDate} onChange={e=>setContact(c=>({...c,dueDate:e.target.value}))}
              className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]" />
          </div>
          <div>
            <label htmlFor="wiz-notes" className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Art / Special Notes</label>
            <textarea id="wiz-notes" rows={3} value={contact.notes} onChange={e=>setContact(c=>({...c,notes:e.target.value}))}
              placeholder="File format, special instructions, ink color refs…"
              className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[var(--brand)] resize-none" />
          </div>
        </div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={contact.taxExempt} onChange={e => setContact(c => ({ ...c, taxExempt: e.target.checked, taxId: e.target.checked ? c.taxId : "" }))}
            className="w-4 h-4 rounded border-slate-300 text-[var(--brand)] focus:ring-[var(--brand)]" />
          <span className="text-sm font-semibold text-slate-600">Tax Exempt</span>
        </label>
        {contact.taxExempt && (
          <div>
            <label htmlFor="wiz-taxId" className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Resale / Tax Exempt Certificate #</label>
            <input id="wiz-taxId" type="text" value={contact.taxId} onChange={e => setContact(c => ({ ...c, taxId: e.target.value }))}
              placeholder="e.g. NV-12345678"
              className="w-full text-sm border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2.5 bg-white dark:bg-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[var(--brand)]" />
          </div>
        )}
      </div>
      <div className="flex justify-end">
        <button
          onClick={()=>contact.name.trim()&&contact.email.trim()&&setStep(3)}
          disabled={!contact.name.trim() || !contact.email.trim()}
          style={contact.name.trim() && contact.email.trim() ? { backgroundColor: bc } : undefined}
          className={`font-semibold px-6 py-2.5 rounded-xl transition ${contact.name.trim() && contact.email.trim() ? "hover:opacity-90 text-white" : "bg-slate-100 text-slate-500 cursor-not-allowed"}`}
        >
          Review Order →
        </button>
      </div>
    </div>
  );
}
