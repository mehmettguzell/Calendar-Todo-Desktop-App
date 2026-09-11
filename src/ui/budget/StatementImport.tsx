import { Check } from "lucide-react";
import { Modal } from "@/ui/components/primitives";
import { ImportDrop } from "./ImportDrop";
import {
  DailyNote,
  ImportAccountField,
  ImportHints,
  ImportSummary,
} from "./ImportSummary";
import { ImportTable } from "./ImportTable";
import { useStatementImport, type ImportModel } from "./importModel";

/**
 * Bringing a bank statement into the ledger.
 *
 * Deliberately a two-step wizard with a preview in the middle. An importer that
 * writes straight from the file is a tool you can only use once — the first
 * wrong guess about a column or a category is in the ledger before you see it,
 * and unpicking eighty rows by hand costs more than typing them would have. The
 * preview is where the guesses are still cheap.
 */
export function StatementImport({ onClose }: { onClose: () => void }) {
  const m = useStatementImport();

  if (m.done !== null) return <ImportDone model={m} onClose={onClose} />;

  return (
    <Modal
      title={m.t("importTitle")}
      onClose={onClose}
      width={880}
      footer={<ImportFooter model={m} onClose={onClose} />}
    >
      {m.plan ? (
        <div className="col" style={{ gap: 10 }}>
          <ImportSummary model={m} plan={m.plan} />
          <DailyNote model={m} />
          <ImportAccountField model={m} />
          <ImportTable model={m} plan={m.plan} />
          <ImportHints model={m} plan={m.plan} />
        </div>
      ) : (
        <ImportDrop model={m} />
      )}
    </Modal>
  );
}

function ImportFooter({
  model: m,
  onClose,
}: {
  model: ImportModel;
  onClose: () => void;
}) {
  return (
    <>
      <span className="grow faint" style={{ fontSize: "var(--text-xs)" }}>
        {m.plan
          ? m.t("importSelected", { n: m.selectedCount })
          : m.t("importPickFile")}
      </span>
      <button type="button" className="btn" onClick={onClose}>
        {m.t("cancel")}
      </button>
      <button
        type="button"
        className="btn primary"
        disabled={m.selectedCount === 0}
        onClick={m.confirm}
      >
        {m.t("importConfirm", { n: m.selectedCount })}
      </button>
    </>
  );
}

function ImportDone({
  model: m,
  onClose,
}: {
  model: ImportModel;
  onClose: () => void;
}) {
  const done = m.done;
  if (!done) return null;

  return (
    <Modal title={m.t("importTitle")} onClose={onClose} width={420}>
      <div className="col" style={{ gap: 10, alignItems: "center", padding: 12 }}>
        <Check size={32} style={{ color: "var(--success)" }} />
        <strong style={{ fontSize: "var(--text-lg)" }}>
          {m.t("importDone", { n: done.created })}
        </strong>
        {done.merged > 0 ? (
          <strong style={{ fontSize: "var(--text-sm)" }}>
            {m.t("importDoneMerged", { n: done.merged })}
          </strong>
        ) : null}
        <p
          className="faint"
          style={{ margin: 0, textAlign: "center", fontSize: "var(--text-xs)" }}
        >
          {m.t("importDoneHint")}
        </p>
        <button type="button" className="btn primary" onClick={onClose}>
          {m.t("close")}
        </button>
      </div>
    </Modal>
  );
}
