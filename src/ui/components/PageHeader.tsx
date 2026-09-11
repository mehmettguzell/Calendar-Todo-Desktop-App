import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The toolbar at the top of a page, the same shape on every page.
 *
 * Six screens had grown six different headers: a gradient icon tile and a
 * subtitle here, a four-figure statistics band there, filter pills in a third
 * place doing the job the band already did. None of them were wrong on their
 * own; together they meant nothing carried over from one screen to the next,
 * so every screen had to be read from scratch.
 *
 * Two shapes, chosen by whether the page names itself:
 *
 *   without a title:  [ how it is filtered ] ……………… what you can do
 *   with one:         name ………………………………………………… what you can do
 *                     [ how it is filtered ]
 *
 * A title is usually left out, because the topbar is already naming the view a
 * few pixels above — printing it twice is the kind of duplication that makes a
 * screen feel busy without adding a single fact. Then the filter and the
 * actions share one line, and the page starts one row sooner.
 */
export function PageHeader({
  title,
  actions,
  tabs,
  className,
}: {
  title?: ReactNode;
  /** What you can do here. Quiet controls; at most one of them loud. */
  actions?: ReactNode;
  /** Usually a `<Segmented>`: which of this page's things are shown. */
  tabs?: ReactNode;
  className?: string;
}) {
  if (!title) {
    return (
      <header className={cn("page-header is-toolbar", className)}>
        {tabs}
        <span className="grow" />
        {actions ? <div className="page-header-actions">{actions}</div> : null}
      </header>
    );
  }

  return (
    <header className={cn("page-header", className)}>
      <div className="page-header-top">
        <h2 className="page-header-title">{title}</h2>
        {actions ? <div className="page-header-actions">{actions}</div> : null}
      </div>
      {tabs ? <div className="page-header-tabs">{tabs}</div> : null}
    </header>
  );
}
