import { useEffect, useId, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { geoPoint, mapPointUrl } from "../lib";
import type { GeoPoint, GeoPlace } from "../lib";
import { Field } from "./form";
import { Modal, useModal } from "./modal";
import { MapCanvas } from "./map";
import type { MapPin } from "./map";

export interface AddressValue {
  address: string;
  latitude: number | null;
  longitude: number | null;
  source_url?: string | null;
}
export function AddressField({
  name = "delivery_address",
  label = "Адреса доставки",
  value,
  onChange,
  disabled = false,
}: {
  name?: string;
  label?: string;
  value: AddressValue;
  onChange: (value: AddressValue) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const parentModal = useModal();
  const point = geoPoint(value.latitude, value.longitude);
  return (
    <div className="address-field">
      <Field
        name={name}
        label={label}
        value={value.address}
        disabled={disabled}
        maxLength={200}
        autoComplete="street-address"
        hint="Вулиця та будинок. Квартиру й під’їзд можна додати в примітку."
        onChange={(address) =>
          onChange({
            address,
            latitude: null,
            longitude: null,
            source_url: null,
          })
        }
      />
      <div className="address-map-actions">
        <button type="button" disabled={disabled} onClick={() => setOpen(true)}>
          <span aria-hidden="true">⌖</span>{" "}
          {point ? "Уточнити на карті" : "Обрати на карті"}
        </button>
        {point && (
          <span className="address-point-saved">Точка на карті збережена</span>
        )}
      </div>
      {open && (
        <LocationPicker
          title={label}
          initial={value}
          onClose={() => setOpen(false)}
          onChoose={(next) => {
            parentModal?.setDirty(true);
            onChange(next);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}
export function LocationPicker({
  title,
  initial,
  onChoose,
  onClose,
}: {
  title: string;
  initial: AddressValue;
  onChoose: (value: AddressValue) => void;
  onClose: () => void;
}) {
  const inputId = useId();
  const [query, setQuery] = useState(initial.address);
  const [items, setItems] = useState<GeoPlace[]>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [point, setPoint] = useState<GeoPoint | null>(() =>
    geoPoint(initial.latitude, initial.longitude),
  );
  const [center, setCenter] = useState<GeoPoint | null>(null);
  const [address, setAddress] = useState(initial.address);
  const [source, setSource] = useState(initial.source_url ?? "");
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      generation.current += 1;
      request.current?.abort();
    };
  }, []);
  const begin = () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    generation.current += 1;
    setError("");
    return { controller, sequence: generation.current };
  };
  const search = async () => {
    if (query.trim().length < 3) {
      setError("Введи вулицю та номер будинку, щонайменше 3 символи");
      return;
    }
    const { controller, sequence } = begin();
    setBusy(true);
    setItems([]);
    setSearched(false);
    try {
      const result = await api.get<{ items: GeoPlace[] }>(
        `/geo/search?${new URLSearchParams({ q: query.trim() })}`,
        controller.signal,
      );
      if (active.current && generation.current === sequence) {
        setItems(result.items);
        setSearched(true);
      }
    } catch (cause) {
      if (
        active.current &&
        generation.current === sequence &&
        !controller.signal.aborted
      )
        setError(
          cause instanceof Error
            ? cause.message
            : "Пошук недоступний. Обери точку на карті",
        );
    } finally {
      if (active.current && generation.current === sequence) setBusy(false);
    }
  };
  const choosePoint = async (next: GeoPoint) => {
    const { controller, sequence } = begin();
    setPoint(next);
    setAddress("");
    setSource(mapPointUrl(next));
    setBusy(true);
    setItems([]);
    try {
      const result = await api.get<{ place: GeoPlace | null }>(
        `/geo/reverse?${new URLSearchParams({ latitude: String(next.latitude), longitude: String(next.longitude) })}`,
        controller.signal,
      );
      if (active.current && generation.current === sequence) {
        setAddress(result.place?.label ?? "");
        if (!result.place)
          setError(
            "Для цієї точки немає підпису. Вкажи вулицю та будинок у полі адреси",
          );
      }
    } catch (cause) {
      if (
        active.current &&
        generation.current === sequence &&
        !controller.signal.aborted
      )
        setError(
          "Точку обрано. Не вдалося визначити адресу, заповни поле адреси",
        );
    } finally {
      if (active.current && generation.current === sequence) setBusy(false);
    }
  };
  const locate = () => {
    if (!navigator.geolocation) {
      setError("Браузер не підтримує геолокацію. Обери точку на карті");
      return;
    }
    const { sequence } = begin();
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (active.current && generation.current === sequence)
          void choosePoint({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
      },
      () => {
        if (active.current && generation.current === sequence) {
          setBusy(false);
          setError(
            "Не вдалося визначити розташування. Дозволь геолокацію або обери точку вручну",
          );
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  };
  const pins = useMemo<MapPin[]>(
    () =>
      point
        ? [
            {
              ...point,
              id: "destination",
              label: "Обрана адреса",
              kind: "destination",
              selected: true,
            },
          ]
        : [],
    [point],
  );
  return (
    <Modal title={title} resetKey={inputId} onClose={onClose}>
      <div
        className="location-picker"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
          }
          if (
            event.key === "Enter" &&
            event.target instanceof HTMLInputElement
          ) {
            if (event.nativeEvent.isComposing) return;
            event.preventDefault();
            event.stopPropagation();
            if (
              event.target.id === inputId &&
              !event.nativeEvent.isComposing &&
              !busy
            )
              void search();
          }
        }}
      >
        <label className="location-search-label" htmlFor={inputId}>
          Знайти адресу
        </label>
        <div className="location-search">
          <div className="location-search-input">
            <input
              id={inputId}
              type="search"
              value={query}
              maxLength={160}
              autoComplete="off"
              placeholder="Наприклад, Київ, Хрещатик, 22"
              onChange={(event) => {
                request.current?.abort();
                generation.current += 1;
                setBusy(false);
                setItems([]);
                setSearched(false);
                setQuery(event.target.value);
              }}
            />
            {query && (
              <button
                type="button"
                className="text-button"
                aria-label="Очистити пошук адреси"
                onClick={() => {
                  request.current?.abort();
                  generation.current += 1;
                  setQuery("");
                  setItems([]);
                  setSearched(false);
                  setBusy(false);
                  setError("");
                  document.getElementById(inputId)?.focus();
                }}
              >
                ×
              </button>
            )}
          </div>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void search()}
          >
            {busy ? "Пошук..." : "Знайти"}
          </button>
        </div>
        <button
          type="button"
          className="location-geolocate text-button"
          disabled={busy}
          onClick={locate}
        >
          ⌖ Моє розташування
        </button>
        {items.length > 0 && (
          <ul className="location-results" aria-label="Знайдені адреси">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    request.current?.abort();
                    generation.current += 1;
                    setBusy(false);
                    setPoint(item);
                    setAddress(item.label);
                    setSource(item.source_url);
                    setItems([]);
                    setError("");
                  }}
                >
                  {item.label}
                  <span aria-hidden="true">↗</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {searched && !items.length && !point && (
          <p className="small" role="status">
            Адресу не знайдено. Уточни запит або обери точку на карті.
          </p>
        )}
        <label className="location-search-label" htmlFor={`${inputId}-address`}>
          Адреса обраної точки
        </label>
        <input
          id={`${inputId}-address`}
          value={address}
          maxLength={200}
          onChange={(event) => {
            request.current?.abort();
            generation.current += 1;
            setBusy(false);
            setError("");
            setSource(point ? mapPointUrl(point) : "");
            setAddress(event.target.value);
          }}
          placeholder="Перевір вулицю та номер будинку"
        />
        <p className="location-picker-error" role="status">
          {error}
        </p>
        <MapCanvas
          label="Вибір точки доставки"
          pins={pins}
          center={point}
          fitKey="address-picker"
          onPick={(next) => void choosePoint(next)}
          onCenter={setCenter}
        />
        <div className="location-map-help">
          <p>
            Натисни на потрібний будинок. Клавішами зі стрілками можна
            перемістити карту.
          </p>
          <button
            type="button"
            disabled={!center || busy}
            onClick={() => {
              if (center) void choosePoint(center);
            }}
          >
            Обрати точку в центрі
          </button>
        </div>
        <div className="location-picker-footer">
          <small>
            Адреси: Photon / OpenStreetMap. Пошук передає лише введений запит.
          </small>
          <div className="actions">
            <button type="button" onClick={onClose}>
              Скасувати
            </button>
            <button
              type="button"
              className="primary"
              disabled={!point || address.trim().length < 3 || busy}
              onClick={() => {
                if (point)
                  onChoose({
                    address: address.trim(),
                    ...point,
                    source_url: source || mapPointUrl(point),
                  });
              }}
            >
              Підтвердити адресу
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
