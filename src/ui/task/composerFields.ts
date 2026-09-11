import { useRef, useState } from "react";
import { toLocalDate } from "@/domain/datetime";
import type { LocalDate, Priority, Recurrence } from "@/domain/types";
import type { Touched } from "./composerDraft";

export interface ComposerDefaults {
  defaultDate?: LocalDate | null;
  defaultTime?: string | null;
  startExpanded?: boolean;
  now: Date;
}

/**
 * Every field the composer holds, with one place to clear them all.
 *
 * "Touched" means the user edited the field, not that it started with a value.
 * Seeding it from `defaultDate` — which the calendar always supplies — meant a
 * parsed date was computed, shown in the preview, and then silently ignored by
 * the field it was supposed to fill.
 */
/* eslint-disable-next-line max-lines-per-function -- fifteen fields relayed, no logic */
export function useComposerFields({
  defaultDate,
  defaultTime,
  startExpanded,
  now,
}: ComposerDefaults) {
  const [title, setTitle] = useState("");
  const [expanded, setExpanded] = useState(Boolean(startExpanded));
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState<string>(defaultDate ?? toLocalDate(now));
  const [endDate, setEndDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [allDay, setAllDay] = useState(!defaultTime);
  const [startTime, setStartTime] = useState(defaultTime ?? "09:00");
  const [endTime, setEndTime] = useState("");
  const [priority, setPriority] = useState<Priority>("NONE");
  const [categoryId, setCategoryId] = useState("");
  const [tags, setTags] = useState("");
  const [recurrence, setRecurrence] = useState<Recurrence | null>(null);
  /*
   * On by default. A task nobody is reminded about is the common complaint this
   * app exists to answer, and the switch is right there for the times it is not
   * wanted. Tasks with no date silently skip it (see submit).
   */
  const [withReminder, setWithReminder] = useState(true);
  const touched = useRef<Touched>({ date: false, time: false });

  const reset = () => {
    setTitle("");
    setDescription("");
    setEndDate("");
    setDeadline("");
    setPriority("NONE");
    setCategoryId("");
    setTags("");
    setRecurrence(null);
    setDueDate(defaultDate ?? toLocalDate(now));
    setAllDay(!defaultTime);
    setStartTime(defaultTime ?? "09:00");
    setEndTime("");
    touched.current = { date: false, time: false };
  };

  return {
    title,
    setTitle,
    expanded,
    setExpanded,
    description,
    setDescription,
    dueDate,
    setDueDate,
    endDate,
    setEndDate,
    deadline,
    setDeadline,
    allDay,
    setAllDay,
    startTime,
    setStartTime,
    endTime,
    setEndTime,
    priority,
    setPriority,
    categoryId,
    setCategoryId,
    tags,
    setTags,
    recurrence,
    setRecurrence,
    withReminder,
    setWithReminder,
    touched,
    reset,
  };
}

export type ComposerFields = ReturnType<typeof useComposerFields>;
