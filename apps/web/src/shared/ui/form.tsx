import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { ChangeEvent, ReactNode } from "react";
import { ApiError } from "../api";
import { useModal } from "./modal";

const ErrorsContext = createContext<Record<string, string>>({});
export const textValue = (data: FormData, name: string) =>
  String(data.get(name) ?? "").trim();
export const numberValue = (data: FormData, name: string) =>
  Number(data.get(name));
type Option = { value: string | number; label: string; disabled?: boolean };
interface FieldProps {
  name: string;
  label: string;
  value?: string | number;
  defaultValue?: string | number;
  onChange?: (value: string) => void;
  type?: string;
  options?: Option[];
  maxLength?: number;
  required?: boolean;
  hint?: string;
  error?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  autoComplete?: string;
}
export function Field({
  name,
  label,
  value,
  defaultValue = "",
  onChange,
  type = "text",
  options,
  maxLength = 200,
  required = true,
  hint,
  error: explicitError,
  min,
  max,
  step,
  disabled,
  autoComplete,
}: FieldProps) {
  const errors = useContext(ErrorsContext);
  const error = explicitError ?? errors[name];
  const [passwordVisible, setPasswordVisible] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const grow = () => {
    if (area.current) {
      area.current.style.height = "auto";
      area.current.style.height = `${Math.min(area.current.scrollHeight, 300)}px`;
    }
  };
  useEffect(grow, [value, defaultValue]);
  const common = {
    id: name,
    name,
    required,
    disabled,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": `${name}-error${hint ? ` ${name}-hint` : ""}`,
    ...(value === undefined ? { defaultValue } : { value }),
    onChange: (
      event: ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) => {
      onChange?.(event.currentTarget.value);
      if (type === "textarea") grow();
    },
  };
  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>
      {options ? (
        <select {...common}>
          {options.map((option) => (
            <option
              key={option.value}
              value={option.value}
              disabled={option.disabled}
            >
              {option.label}
            </option>
          ))}
        </select>
      ) : type === "textarea" ? (
        <textarea
          {...common}
          ref={area}
          maxLength={maxLength}
          className="resize-none"
        />
      ) : type === "password" ? (
        <div className="password-field">
          <input {...common} type={passwordVisible ? "text" : "password"} maxLength={maxLength} autoComplete={autoComplete} />
          <button type="button" aria-label={passwordVisible ? "Приховати пароль" : "Показати пароль"} aria-pressed={passwordVisible} onClick={() => setPasswordVisible((visible) => !visible)}>
            {passwordVisible ? "Приховати" : "Показати"}
          </button>
        </div>
      ) : (
        <input
          {...common}
          type={type}
          maxLength={maxLength}
          min={min}
          max={max}
          step={step}
          autoComplete={autoComplete}
        />
      )}{" "}
      {hint && (
        <span className="hint" id={`${name}-hint`}>
          {hint}
        </span>
      )}
      <span className="err" id={`${name}-error`}>
        {error}
      </span>
    </div>
  );
}
export function CheckField({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked: boolean;
}) {
  return (
    <div className="check-field">
      <input
        id={name}
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked}
      />
      <label htmlFor={name}>{label}</label>
    </div>
  );
}
export function FieldError({ name }: { name: string }) {
  const errors = useContext(ErrorsContext);
  return (
    <span className="err" id={`${name}-error`}>
      {errors[name]}
    </span>
  );
}
interface FormProps<T> {
  children: ReactNode;
  submitLabel?: string;
  cancelLabel?: string;
  hideCancel?: boolean;
  danger?: boolean;
  onSubmit: (data: FormData) => Promise<T>;
  onSuccess: (result: T) => void;
  validate?: (data: FormData) => Record<string, string>;
  onCancel?: () => void;
  extraActions?: ReactNode;
  className?: string;
  disabled?: boolean;
}
export function AppForm<T>({
  children,
  submitLabel = "Зберегти",
  cancelLabel = "Скасувати",
  hideCancel,
  danger,
  onSubmit,
  onSuccess,
  validate,
  onCancel,
  extraActions,
  className,
  disabled,
}: FormProps<T>) {
  const modal = useModal();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const ref = useRef<HTMLFormElement>(null);
  const active = useRef(true);
  const errorId = useId();
  useEffect(() => {
    active.current = true;
    if (modal)
      ref.current
        ?.querySelector<HTMLElement>("input, select, textarea, button")
        ?.focus();
    return () => { active.current = false; };
  }, []);
  function focusError(fields: Record<string, string>) {
    setErrors(fields);
    requestAnimationFrame(() => {
      const control =
        [...(ref.current?.elements ?? [])].find(
          (element) =>
            element instanceof HTMLElement &&
            "name" in element &&
            typeof element.name === "string" &&
            fields[element.name],
        ) ?? (fields.items ? ref.current?.querySelector("#items") : undefined);
      if (control instanceof HTMLElement) {
        control.focus();
        control.scrollIntoView({ block: "nearest" });
      }
    });
  }
  return (
    <ErrorsContext value={errors}>
      <form
        ref={ref}
        className={className}
        noValidate
        aria-busy={busy}
        aria-describedby={message ? errorId : undefined}
        onChange={() => modal?.setDirty(true)}
        onSubmit={async (event) => {
          event.preventDefault();
          if (
            busyRef.current ||
            disabled ||
            (event.nativeEvent instanceof KeyboardEvent &&
              event.nativeEvent.isComposing)
          )
            return;
          const data = new FormData(event.currentTarget);
          const fields: Record<string, string> = {};
          for (const element of event.currentTarget.elements) {
            if (
              (element instanceof HTMLInputElement ||
                element instanceof HTMLSelectElement ||
                element instanceof HTMLTextAreaElement) &&
              element.required &&
              !element.value.trim()
            )
              fields[element.name] = "Заповніть поле";
          }
          Object.assign(fields, validate?.(data));
          setMessage("");
          if (Object.keys(fields).length) {
            focusError(fields);
            setMessage(Object.values(fields).join(". "));
            return;
          }
          setErrors({});
          busyRef.current = true;
          setBusy(true);
          modal?.setBusy(true);
          try {
            const result = await onSubmit(data);
            if (!active.current) return;
            modal?.setDirty(false);
            onSuccess(result);
          } catch (error) {
            if (!active.current) return;
            setMessage(
              error instanceof Error
                ? error.message
                : "Не вдалося зберегти дані",
            );
            if (error instanceof ApiError) focusError(error.fields);
          } finally {
            busyRef.current = false;
            if (active.current) {
              setBusy(false);
              modal?.setBusy(false);
            }
          }
        }}
      >
        <fieldset disabled={busy}>
          {children}
          <div className="form-error" id={errorId} role={busy ? "status" : "alert"}>
            {busy ? <span className="form-progress">Виконуємо запит…</span> : message}
          </div>
          <div className="form-actions">
            {!hideCancel && (
              <button type="button" onClick={onCancel ?? modal?.requestClose}>
                {cancelLabel}
              </button>
            )}
            <button
              className={danger ? "danger" : "primary"}
              type="submit"
              disabled={disabled}
            >
              {submitLabel}
            </button>
            {extraActions}
          </div>
        </fieldset>
      </form>
    </ErrorsContext>
  );
}
