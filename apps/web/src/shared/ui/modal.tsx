import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

interface ModalControls {
  setDirty: (dirty: boolean) => void;
  setBusy: (busy: boolean) => void;
  requestClose: () => void;
}
const ModalContext = createContext<ModalControls | null>(null);
export const useModal = () => useContext(ModalContext);

export function Modal({
  title,
  resetKey,
  children,
  onClose,
}: {
  title: string;
  resetKey: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const opener = useRef<HTMLElement | null>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState(false);
  const requestClose = useCallback(() => {
    if (busy) return;
    if (dirty) setWarning(true);
    else closeRef.current();
  }, [busy, dirty]);
  useEffect(() => {
    opener.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      if (opener.current?.isConnected)
        opener.current.focus({ preventScroll: true });
      else
        document
          .querySelector<HTMLElement>("#main")
          ?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    setDirty(false);
    setBusy(false);
    setWarning(false);
    queueMicrotask(() =>
      ref.current
        ?.querySelector<HTMLElement>(
          "[data-autofocus], .modal-content input, .modal-content select, .modal-content textarea, .modal-content button",
        )
        ?.focus(),
    );
  }, [resetKey]);
  useEffect(() => {
    if (warning) keepEditing.current?.focus();
  }, [warning]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  return (
    <ModalContext value={{ setDirty, setBusy, requestClose }}>
      <dialog
        ref={ref}
        className="modal"
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault();
          event.stopPropagation();
          requestClose();
        }}
        onKeyDown={(event) => {
          if (
            event.key !== "Tab" ||
            (event.target instanceof Element &&
              event.target.closest("dialog") !== event.currentTarget)
          )
            return;
          const controls = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
            ),
          ].filter(
            (control) =>
              control.offsetParent !== null && !control.closest("[inert]"),
          );
          const first = controls[0],
            last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <div className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="icon-button"
            disabled={busy}
            aria-label="Закрити діалог"
            onClick={requestClose}
          >
            ×
          </button>
        </div>
        <div className="modal-content" inert={warning}>
          {children}
        </div>
        {warning && (
          <div className="dirty-warning" role="alert">
            <p>Є незбережені зміни. Відкинути їх?</p>
            <button
              type="button"
              ref={keepEditing}
              onClick={() => {
                setWarning(false);
                queueMicrotask(() =>
                  ref.current
                    ?.querySelector<HTMLElement>(
                      ".modal-content input, .modal-content select, .modal-content textarea",
                    )
                    ?.focus(),
                );
              }}
            >
              Продовжити редагування
            </button>
            <button
              type="button"
              className="danger"
              onClick={() => closeRef.current()}
            >
              Відкинути зміни
            </button>
          </div>
        )}
      </dialog>
    </ModalContext>
  );
}
