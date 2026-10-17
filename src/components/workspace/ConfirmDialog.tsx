import { Modal } from '@/components/workspace/Modal';
import { btn, btnPrimary } from '@/components/workspace/ui';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm(): void;
  onCancel(): void;
}

/** In-app confirmation (never window.confirm, which would block on a native dialog). */
export function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      width="max-w-md"
      footer={(
        <>
          <button type="button" className={btn} onClick={onCancel}>Cancel</button>
          <button type="button" className={btnPrimary} onClick={onConfirm} data-autofocus>{confirmLabel}</button>
        </>
      )}
    >
      <p className="text-sm">{message}</p>
    </Modal>
  );
}
