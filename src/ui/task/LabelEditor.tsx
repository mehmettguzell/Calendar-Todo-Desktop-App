import {
  useState,
} from "react";
import {
  X,
} from "lucide-react";
import {
  NOTE_TAG,
} from "@/domain/note";

export function LabelEditor({
  labels,
  onChange,
}: {
  labels: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const value = draft.trim().replace(/^#/, "");
    setDraft("");
    // Reserved namespaces would make a label indistinguishable from metadata.
    if (!value || value === NOTE_TAG || value.startsWith("note:")) return;
    if (labels.includes(value)) return;
    onChange([...labels, value]);
  };

  return (
    <div className="note-tags grow" style={{ alignItems: "center" }}>
      {labels.map((label) => (
        <span key={label} className="note-tag removable">
          {label}
          <button
            type="button"
            aria-label={`Remove ${label}`}
            onClick={() => onChange(labels.filter((l) => l !== label))}
          >
            <X size={9} />
          </button>
        </span>
      ))}
      <input
        className="tag-input"
        value={draft}
        placeholder={labels.length ? "Add tag…" : "Add a tag…"}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && labels.length) {
            onChange(labels.slice(0, -1));
          }
        }}
      />
    </div>
  );
}
