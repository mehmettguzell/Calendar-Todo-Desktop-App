import { AlertTriangle, Upload } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ImportModel } from "./importModel";

/** Step one: hand the wizard a file, or paste the rows straight in. */
export function ImportDrop({ model: m }: { model: ImportModel }) {
  const openFile = (file: File | undefined) => {
    if (file) void m.readFile(file);
  };

  return (
    <div className="col" style={{ gap: 12 }}>
      <div
        className={cn("import-drop", m.dragging && "over")}
        onDragOver={(e) => {
          e.preventDefault();
          m.setDragging(true);
        }}
        onDragLeave={() => m.setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          m.setDragging(false);
          openFile(e.dataTransfer.files[0]);
        }}
        onClick={() => m.inputRef.current?.click()}
      >
        <Upload size={26} />
        <strong>{m.t("importDropTitle")}</strong>
        <span
          className="faint"
          style={{ fontSize: "var(--text-xs)", textAlign: "center" }}
        >
          {m.t("importDropHint")}
        </span>
        <input
          ref={m.inputRef}
          type="file"
          accept=".pdf,.csv,.txt,.xls,.tsv,application/pdf,text/csv,text/plain"
          hidden
          onChange={(e) => openFile(e.target.files?.[0])}
        />
      </div>

      {m.reading ? <p className="faint">{m.t("importReadingPdf")}</p> : null}

      {m.error ? (
        <p className="import-error">
          <AlertTriangle size={14} /> {m.t(m.error)}
        </p>
      ) : null}

      <label className="field">
        <span>{m.t("importPasteLabel")}</span>
        <textarea
          className="textarea mono"
          rows={6}
          placeholder={m.t("importPastePlaceholder")}
          onChange={(e) => {
            m.setFileName(null);
            m.setError(null);
            m.setText(e.target.value);
          }}
        />
      </label>
    </div>
  );
}
