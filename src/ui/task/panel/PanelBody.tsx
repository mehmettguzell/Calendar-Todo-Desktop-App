import {
  AlarmClock,
  Square,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Field,
} from "@/ui/components/primitives";
import { SnoozeMenu } from "../SnoozeMenu";
import type { TaskPanelModel } from "./useTaskPanel";
import { ParentCrumb } from "./ParentCrumb";
import { PanelEssentials } from "./PanelEssentials";
import { PanelSections } from "./PanelSections";
import { ResistanceCard } from "./ResistanceCard";

/** The task itself: breadcrumb, title, description, fields, folded sections. */
export function PanelBody({ model: m }: { model: TaskPanelModel }) {
  return (
    <div className="panel-body scroll">
      <ParentCrumb
        parent={m.parentTask}
        onOpen={m.onOpenTask}
        onDetach={() => m.setParent(m.task.id, null)}
        t={m.t}
      />
      <textarea
        ref={m.titleRef}
        className="panel-title-input"
        rows={1}
        value={m.title}
        onChange={(e) => m.setTitle(e.target.value)}
        onBlur={m.commitTitle}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          e.currentTarget.blur();
        }}
        placeholder={m.t("untitledTask")}
      />

      <div className="row" style={{ position: "relative", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn primary"
          onClick={() => m.toggleComplete(m.instance)}
        >
          {m.instance.storedStatus === "COMPLETED"
            ? m.t("menuReopen")
            : m.t("menuComplete")}
        </button>
        {/* Ghost, not filled. Three buttons at the same weight is three
            buttons with no answer to "which one did I come here for" —
            finishing the task is the answer, and it is the only one wearing
            the accent. */}
        {/* This button said "Duraklat" and ended the session — and put the
            task back to TODO, so stepping away for five minutes read as
            never having started. It pauses now, which is what it says, and
            finishing gets a button of its own beside it. */}
        <button
          type="button"
          className={cn("btn ghost", m.isFocused && !m.isPaused && "active")}
          onClick={() => {
            if (!m.isFocused) m.startFocus(m.instance);
            else if (m.isPaused) m.resumeFocus();
            else m.pauseFocus();
          }}
        >
          {m.isPaused ? m.t("resume") : m.isFocused ? m.t("pause") : m.t("startShort")}
        </button>
        {m.isFocused ? (
          <button
            type="button"
            className="btn ghost"
            onClick={() => m.stopFocus()}
          >
            <Square size={14} /> {m.t("focusStop")}
          </button>
        ) : null}
        <button
          type="button"
          className="btn ghost"
          onClick={() => m.setSnoozeOpen((v) => !v)}
        >
          <AlarmClock size={14} /> {m.t("snooze")}
        </button>
        {m.instance.status === "SNOOZED" ? (
          <button
            type="button"
            className="btn ghost"
            onClick={() => m.clearSnooze(m.ref)}
          >
            {m.t("wakeNow")}
          </button>
        ) : null}
        {m.snoozeOpen ? (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              marginTop: 4,
            }}
          >
            <SnoozeMenu
              instance={m.instance}
              onClose={() => m.setSnoozeOpen(false)}
            />
          </div>
        ) : null}
      </div>

      <Field label={m.t("formNotes")}>
        <textarea
          className="textarea"
          value={m.description}
          placeholder={m.t("notesPlaceholder")}
          onChange={(e) => m.setDescription(e.target.value)}
          onBlur={() =>
            m.description !== m.task.description &&
            m.updateTask(m.task.id, { description: m.description })
          }
        />
      </Field>

      {/* Scheduling and priority are the two edits almost every visit makes,
          so they are the two that are never behind a fold. */}
      <PanelEssentials model={m} />

      <PanelSections model={m} />
      <ResistanceCard model={m} />
    </div>
  );
}
