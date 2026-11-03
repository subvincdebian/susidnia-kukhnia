import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { Resource } from "../api";

export function Heading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children && <div className="actions">{children}</div>}
    </div>
  );
}
export function Empty({
  title = "Записів ще немає",
  hint,
  onReset,
}: {
  title?: string;
  hint?: string;
  onReset?: () => void;
}) {
  return (
    <div className="state">
      <h2>{title}</h2>
      {hint && <p>{hint}</p>}
      {onReset && <button onClick={onReset}>Очистити фільтри</button>}
    </div>
  );
}
export function Async<T>({
  resource,
  children,
  quiet = false,
}: {
  resource: Resource<T>;
  children: (data: T) => ReactNode;
  quiet?: boolean;
}) {
  if (!resource.data) {
    if (resource.error)
      return (
        <div className="state" role="alert">
          <h2>Не вдалося завантажити дані</h2>
          <p>{resource.error.message}</p>
          <button onClick={resource.retry}>Повторити</button>
        </div>
      );
    return (
      <div className="state" role="status">
        Завантаження даних...
      </div>
    );
  }
  return (
    <div aria-busy={resource.loading}>
      {resource.loading && (
        <div className={quiet ? "sr-only" : "loadingline"} role="status">
          Оновлення даних...
        </div>
      )}
      {resource.error && (
        <div className="inline-alert" role="alert">
          <p>{resource.error.message}</p>
          <button onClick={resource.retry}>Повторити</button>
        </div>
      )}
      {children(resource.data)}
    </div>
  );
}
export function Table({
  headers,
  rows,
  label,
}: {
  headers: string[];
  rows: ReactNode[][];
  label: string;
}) {
  return (
    <div className="table-frame">
      <div className="table-scroll">
        <table aria-label={label}>
          <thead>
            <tr>
              {headers.map((header, index) => (
                <th scope="col" key={`${header}-${index}`}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
export function Pagination({
  data,
  onPage,
}: {
  data: { total: number; page: number; size: number; pages: number };
  onPage: (page: number) => void;
}) {
  return (
    <nav className="pagination" aria-label="Сторінки результатів">
      <span>
        {data.total
          ? `${(data.page - 1) * data.size + 1}-${Math.min(data.page * data.size, data.total)} із ${data.total}`
          : "0 записів"}
      </span>
      <div className="actions">
        <button onClick={() => onPage(data.page - 1)} disabled={data.page <= 1}>
          Назад
        </button>
        <span aria-live="polite">
          {data.page} / {data.pages}
        </span>
        <button
          onClick={() => onPage(data.page + 1)}
          disabled={data.page >= data.pages}
        >
          Далі
        </button>
      </div>
    </nav>
  );
}
export function Search({
  value,
  placeholder,
  onSearch,
  onClear,
}: {
  value: string;
  placeholder: string;
  onSearch: (value: string) => void;
  onClear: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const composing = useRef(false);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const commit = (next: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onSearch(next), 300);
  };
  return (
    <div className="search-wrap">
      <label className="sr-only" htmlFor="search">
        Пошук
      </label>
      <input
        ref={ref}
        id="search"
        type="search"
        maxLength={100}
        placeholder={placeholder}
        value={draft}
        onCompositionStart={() => {
          composing.current = true;
          clearTimeout(timer.current);
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          commit(event.currentTarget.value);
        }}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setDraft(next);
          if (
            !composing.current &&
            !(
              event.nativeEvent instanceof InputEvent &&
              event.nativeEvent.isComposing
            )
          ) {
            if (!next) {
              clearTimeout(timer.current);
              onSearch("");
            } else commit(next);
          }
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !(
              event.nativeEvent instanceof InputEvent &&
              event.nativeEvent.isComposing
            )
          ) {
            event.preventDefault();
            clearTimeout(timer.current);
            onSearch(draft);
          }
        }}
      />
      {draft && (
        <button
          type="button"
          aria-label="Очистити пошук"
          onClick={() => {
            clearTimeout(timer.current);
            setDraft("");
            onClear();
            ref.current?.focus();
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
const NotificationContext = createContext<(message: string) => void>(
  () => undefined,
);
export const useNotify = () => useContext(NotificationContext);
export function Notifications({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((value: string) => {
    setMessage(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 6000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <NotificationContext value={notify}>
      {children}
      <div
        className={`notification ${message ? "show" : ""}`}
        role="status"
        aria-live="polite"
      >
        {message}
      </div>
    </NotificationContext>
  );
}
