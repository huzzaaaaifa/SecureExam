// File purpose: Global status banner rendered by App when there is a message to show.

import type { AppStatus } from '../types';

interface Props {
  status: AppStatus;
}

export default function StatusBanner({ status }: Props) {
  const cls =
    status.variant === 'error'   ? 'banner banner--error' :
    status.variant === 'success' ? 'banner banner--success' :
                                   'banner banner--neutral';
  return (
    <div className={cls} role="status" aria-live="polite">
      {status.message}
    </div>
  );
}
