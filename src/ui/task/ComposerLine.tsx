import { ChevronDown, ChevronUp, CornerDownLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n";

/**
 * The one line the composer is mostly made of.
 *
 * "Detaylar" is named rather than drawn as a bare chevron: a caret at the end of
 * an input is a control nobody presses because nobody knows what is behind it,
 * and what is behind it is every field this box replaced. The submit button
 * appears with the first character, because a disabled grey button on an empty
 * box is dead weight on the busiest row of the page.
 */
export function ComposerLine({
  id,
  inputRef,
  title,
  setTitle,
  placeholder,
  autoFocus,
  expanded,
  setExpanded,
  ready,
  submit,
  onCancel,
  setFocused,
  submitLabel,
}: {
  id: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  title: string;
  setTitle: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  expanded: boolean;
  setExpanded: (next: (open: boolean) => boolean) => void;
  ready: boolean;
  submit: () => void;
  onCancel?: () => void;
  submitLabel?: string;
  setFocused: (focused: boolean) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="composer-line">
      <input
        id={id}
        ref={inputRef}
        className="composer-input"
        autoFocus={autoFocus}
        value={title}
        placeholder={placeholder ?? t("composerPlaceholder")}
        aria-label={t("formTitle")}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape" && onCancel) {
            onCancel();
          }
        }}
      />
      {/* Named, not just a chevron. A bare caret at the end of an input is a
          control nobody presses because nobody knows what is behind it, and
          what is behind it is every field this box replaced. */}
      <button
        type="button"
        className={cn("btn ghost sm composer-details-btn", expanded && "active")}
        aria-expanded={expanded}
        title={t("composerDetails")}
        onClick={() => setExpanded((v) => !v)}
      >
        {t("composerDetails")}
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {/* The button appears with the first character.
          A disabled grey button sitting on an empty box is dead weight on
          the one control the whole app is trying to make inviting; an empty
          composer is now just a line waiting to be typed in. */}
      {ready ? (
        <button type="button" className="btn primary sm" onClick={submit}>
          <CornerDownLeft size={13} /> {submitLabel ?? t("add")}
        </button>
      ) : null}
    </div>
  );
}
