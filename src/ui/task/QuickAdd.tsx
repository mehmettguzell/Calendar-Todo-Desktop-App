import type { LocalDate } from "@/domain/types";
import { useI18n } from "@/lib/i18n";
import { Modal } from "@/ui/components/primitives";
import { Composer } from "./Composer";

/**
 * The new-task modal: a frame around `Composer`, and nothing else.
 *
 * Everything that used to live here — the twelve fields, the parse, the
 * reminder rule — moved into the composer, because the same act happens
 * inline on four other screens and a modal is only one of the doors to it.
 * Reached from the topbar button, `Ctrl+N`, the command palette, a click on a
 * calendar cell, and the tray's global capture shortcut. All five now produce
 * the same box.
 *
 * It opens with the details already unfolded: someone who chose the modal over
 * the line on the page in front of them is usually after the fields.
 */
export function QuickAdd({
  defaultDate,
  defaultTime,
  onClose,
  onCreated,
}: {
  defaultDate?: LocalDate | null;
  defaultTime?: string | null;
  onClose: () => void;
  onCreated?: (taskId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <Modal title={t("formNewTask")} onClose={onClose}>
      <Composer
        variant="modal"
        autoFocus
        startExpanded
        defaultDate={defaultDate}
        defaultTime={defaultTime}
        submitLabel={t("formCreateTask")}
        onCancel={onClose}
        onCreated={(taskId) => {
          onCreated?.(taskId);
          onClose();
        }}
      />
    </Modal>
  );
}
