import EmbedSnippets from "../components/wizard/EmbedSnippets";

// /Embed remains a routable page so old direct links / bookmarks keep
// working, but it's no longer in the sidebar — the snippets live in a
// collapsable section on the Wizard page itself. Thin wrapper now.
export default function Embed() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Embed Quote Wizard</h2>
        <p className="text-slate-500 text-sm mt-1">
          Paste one of these snippets into your website so customers can submit
          quote requests directly — they'll show up in your Quotes page automatically.
        </p>
      </div>
      <EmbedSnippets />
    </div>
  );
}
