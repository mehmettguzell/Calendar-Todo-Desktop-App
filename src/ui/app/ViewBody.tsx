import type { LocalDate, TaskInstance } from "@/domain/types";
import type { Filters } from "@/state/selectors";
import type { ViewId } from "@/ui/Sidebar";
import { BudgetView } from "@/ui/views/BudgetView";
import { CalendarView, type CalendarMode } from "@/ui/views/CalendarView";
import { FocusView } from "@/ui/views/FocusView";
import { NotesView } from "@/ui/views/NotesView";
import { PlansView } from "@/ui/views/PlansView";
import { TasksView } from "@/ui/views/TasksView";
import { TodayView } from "@/ui/views/TodayView";

export interface ViewBodyProps {
  view: ViewId;
  mode: CalendarMode;
  anchor: LocalDate;
  filters: Filters;
  selectedKey: string | null;
  daySelection: LocalDate | null;
  onSelectDate: (date: LocalDate | null) => void;
  onOpen: (instance: TaskInstance) => void;
  onQuickAdd: (date: LocalDate, time: string | null) => void;
  onView: (view: ViewId) => void;
  onAnchor: (date: LocalDate) => void;
}

/** Which page is on screen. One branch per view, and nothing else. */
export function ViewBody(props: ViewBodyProps) {
  const { view, filters, selectedKey, onOpen } = props;
  const listProps = { filters, selectedKey, onOpen };

  switch (view) {
    case "today":
      return (
        <TodayView
          {...listProps}
          // The week strip doubles as navigation, the same way the mini month in
          // the sidebar does.
          onPickDate={(date) => {
            props.onAnchor(date);
            props.onView("calendar");
          }}
        />
      );
    case "calendar":
      return (
        <CalendarView
          mode={props.mode}
          anchor={props.anchor}
          filters={filters}
          selectedDate={props.daySelection}
          onSelectDate={props.onSelectDate}
          onOpen={onOpen}
          onQuickAdd={props.onQuickAdd}
        />
      );
    case "tasks":
      return <TasksView {...listProps} />;
    case "plans":
      return <PlansView selectedKey={selectedKey} onOpen={onOpen} />;
    case "notes":
      return <NotesView selectedKey={selectedKey} onOpen={onOpen} />;
    case "focus":
      return <FocusView {...listProps} />;
    case "budget":
      return <BudgetView />;
  }
}
