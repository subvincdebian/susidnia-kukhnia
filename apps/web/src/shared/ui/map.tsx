import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import type { GeoPoint } from "../lib";
import { api } from "../api";
import "leaflet/dist/leaflet.css";

export interface MapPin extends GeoPoint {
  id: string;
  label: string;
  kind?: "restaurant" | "destination" | "courier";
  selected?: boolean;
  muted?: boolean;
}
interface Props {
  label: string;
  pins: MapPin[];
  route?: [number, number][];
  center?: GeoPoint | null;
  fitKey?: string;
  onSelect?: (id: string) => void;
  onPick?: (point: GeoPoint) => void;
  onCenter?: (point: GeoPoint) => void;
}
const kyiv: GeoPoint = { latitude: 50.4501, longitude: 30.5234 };
const symbols = {
  restaurant: '<path d="M5 17h14M7 14a5 5 0 0 1 10 0M12 6v2"/>',
  destination: '<path d="m4 11 8-7 8 7M7 10v10h10V10M11 20v-6h3v6"/>',
  courier:
    '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="m6 17 4-8 5 8H6m4-8h5l3 8M9 6h3"/>',
};
export function MapCanvas(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const library = useRef<typeof Leaflet | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    let resize: ResizeObserver | undefined;
    setReady(false);
    setError("");
    setLoading(true);
    const controller = new AbortController();
    void Promise.all([
      import("leaflet"),
      api.get<{ tile_url: string }>("/geo/config", controller.signal),
    ])
      .then(([L, configuration]) => {
        if (!active || !container.current) return;
        library.current = L;
        const initial = callbacks.current.center ?? kyiv;
        const instance = L.map(container.current, {
          center: [initial.latitude, initial.longitude],
          zoom: 13,
          scrollWheelZoom: false,
          zoomControl: false,
          zoomAnimation: false,
          fadeAnimation: false,
          markerZoomAnimation: false,
        });
        map.current = instance;
        instance.attributionControl.setPrefix(false);
        L.control
          .zoom({
            position: "topright",
            zoomInTitle: "Наблизити",
            zoomOutTitle: "Віддалити",
          })
          .addTo(instance);
        const tiles = L.tileLayer(configuration.tile_url, {
          maxZoom: 19,
          keepBuffer: 1,
          updateWhenIdle: true,
          attribution:
            '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
        }).addTo(instance);
        tiles.on("load", () => {
          if (active) setLoading(false);
        });
        tiles.on("tileerror", () => {
          if (active) {
            setLoading(false);
            setError("Не вдалося завантажити частину карти");
          }
        });
        layer.current = L.layerGroup().addTo(instance);
        instance.on("click", (event: Leaflet.LeafletMouseEvent) =>
          callbacks.current.onPick?.({
            latitude: event.latlng.lat,
            longitude: event.latlng.lng,
          }),
        );
        instance.on("moveend", () => {
          const current = instance.getCenter();
          callbacks.current.onCenter?.({
            latitude: current.lat,
            longitude: current.lng,
          });
        });
        resize = new ResizeObserver(() =>
          instance.invalidateSize({ pan: false, animate: false }),
        );
        resize.observe(container.current);
        setReady(true);
      })
      .catch(() => {
        if (active) {
          setLoading(false);
          setError("Карта недоступна. Спробуй ще раз");
        }
      });
    return () => {
      active = false;
      controller.abort();
      resize?.disconnect();
      map.current?.remove();
      map.current = null;
      layer.current = null;
      library.current = null;
    };
  }, [retry]);
  useEffect(() => {
    const L = library.current,
      currentLayer = layer.current;
    if (!ready || !L || !currentLayer) return;
    const focusedPin =
      document.activeElement instanceof HTMLElement &&
      document.activeElement.matches(".map-marker:focus-visible")
        ? document.activeElement.dataset.pinId
        : null;
    currentLayer.clearLayers();
    for (const pin of props.pins) {
      const kind = pin.kind ?? "restaurant";
      const icon = L.divIcon({
        className: `map-marker map-marker-${kind}${pin.selected ? " is-selected" : ""}${pin.muted ? " is-muted" : ""}`,
        html: `<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">${symbols[kind]}</svg></span>`,
        iconSize: [38, 44],
        iconAnchor: [19, 42],
      });
      const marker = L.marker([pin.latitude, pin.longitude], {
        icon,
        title: pin.label,
        alt: pin.label,
        keyboard: true,
        zIndexOffset: pin.selected ? 500 : kind === "courier" ? 300 : 0,
      }).addTo(currentLayer);
      marker.getElement()?.setAttribute("aria-label", pin.label);
      const element = marker.getElement();
      if (element) {
        element.dataset.pinId = pin.id;
        if (focusedPin === pin.id) element.focus({ preventScroll: true });
      }
      const caption = document.createElement("span");
      caption.textContent = pin.label;
      marker.bindTooltip(caption, { direction: "top", offset: [0, -35] });
      marker.on("click", () => callbacks.current.onSelect?.(pin.id));
    }
    if (props.route?.length && container.current) {
      L.polyline(
        props.route.map<Leaflet.LatLngTuple>(([longitude, latitude]) => [
          latitude,
          longitude,
        ]),
        {
          color: getComputedStyle(container.current)
            .getPropertyValue("--primary")
            .trim(),
          weight: 5,
          opacity: 0.8,
          lineCap: "round",
        },
      ).addTo(currentLayer);
    }
  }, [ready, props.pins, props.route]);
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    const points: GeoPoint[] = [
      ...callbacks.current.pins,
      ...(callbacks.current.route ?? []).map(([longitude, latitude]) => ({
        latitude,
        longitude,
      })),
    ];
    if (points.length > 1) {
      instance.fitBounds(
        points.map<Leaflet.LatLngTuple>((point) => [
          point.latitude,
          point.longitude,
        ]),
        { padding: [42, 42], maxZoom: 16, animate: false },
      );
    } else {
      const point = callbacks.current.center ?? points[0] ?? kyiv;
      instance.setView(
        [point.latitude, point.longitude],
        points.length ? 16 : 13,
        { animate: false },
      );
    }
  }, [ready, props.fitKey]);
  useEffect(() => {
    if (ready && props.center)
      map.current?.setView(
        [props.center.latitude, props.center.longitude],
        16,
        { animate: false },
      );
  }, [ready, props.center?.latitude, props.center?.longitude]);
  return (
    <div className="map-surface">
      <div
        ref={container}
        className="map-canvas"
        role="region"
        aria-label={props.label}
      />
      {loading && (
        <div className="map-loading" role="status">
          Завантаження карти...
        </div>
      )}
      {error && (
        <div className="map-error" role="status">
          <span>{error}</span>
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Повторити
          </button>
        </div>
      )}
    </div>
  );
}
