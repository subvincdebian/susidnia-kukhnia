import type { ReactNode } from "react";
import { openPage, pageHref } from "../lib";
export function PageLink({
  view,
  params,
  children,
  className,
  current,
  onFollow,
  label,
}: {
  view: string;
  params?: Record<string, string | number>;
  children: ReactNode;
  className?: string;
  current?: boolean;
  onFollow?: () => void;
  label?: string;
}) {
  return (
    <a
      href={pageHref(view, params)}
      className={className}
      aria-label={label}
      aria-current={current ? "page" : undefined}
      onClick={(event) => {
        if (
          event.button === 0 &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          event.preventDefault();
          onFollow?.();
          openPage(view, params);
        }
      }}
    >
      {children}
    </a>
  );
}
