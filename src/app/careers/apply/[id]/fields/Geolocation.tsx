"use client";

import { useState } from "react";
import { LocateFixed, Loader2 } from "lucide-react";
import { FieldFrame, inputClass } from "./FieldFrame";
import type { RendererProps } from "./types";

function numberText(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

/**
 * Two boxes that are always typeable, and one button that fills them **only
 * when clicked** (spec §3). Choosing a location is an explicit act, so nothing
 * here asks the browser for a position on mount or on any other render.
 */
export function Geolocation({
  id,
  label,
  help,
  required,
  value,
  onChange,
  error,
  t,
}: RendererProps) {
  const pair = (typeof value === "object" && value !== null ? value : {}) as {
    lat?: unknown;
    lng?: unknown;
  };
  const [latText, setLatText] = useState(numberText(pair.lat));
  const [lngText, setLngText] = useState(numberText(pair.lng));
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const emit = (lat: string, lng: string) => {
    setLatText(lat);
    setLngText(lng);
    if (lat.trim() === "" || lng.trim() === "") {
      onChange({});
      return;
    }
    onChange({ lat: Number(lat), lng: Number(lng) });
  };

  const locate = () => {
    setNote(null);
    if (!("geolocation" in navigator)) {
      setNote(t("apply.dyn.locationFailed"));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        emit(String(position.coords.latitude), String(position.coords.longitude));
        setLocating(false);
      },
      () => {
        setNote(t("apply.dyn.locationFailed"));
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  };

  return (
    <FieldFrame id={id} label={label} help={help} required={required} error={error} legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <label htmlFor={`${id}-lat`} className="block">
          <span className="mb-1 block text-[11px] font-semibold text-brand-ink/55">
            {t("apply.dyn.lat")}
          </span>
          <input
            id={`${id}-lat`}
            type="number"
            inputMode="decimal"
            step="any"
            value={latText}
            onChange={(event) => emit(event.target.value, lngText)}
            className={inputClass(error)}
          />
        </label>
        <label htmlFor={`${id}-lng`} className="block">
          <span className="mb-1 block text-[11px] font-semibold text-brand-ink/55">
            {t("apply.dyn.lng")}
          </span>
          <input
            id={`${id}-lng`}
            type="number"
            inputMode="decimal"
            step="any"
            value={lngText}
            onChange={(event) => emit(latText, event.target.value)}
            className={inputClass(error)}
          />
        </label>
      </div>

      <button
        type="button"
        onClick={locate}
        disabled={locating}
        className="mt-2 inline-flex items-center gap-1.5 rounded-xl border border-brand-line bg-white px-3 py-2 text-xs font-bold text-brand-ink/70 transition hover:border-brand-gold disabled:opacity-60"
      >
        {locating ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        ) : (
          <LocateFixed className="h-3.5 w-3.5" aria-hidden />
        )}
        {locating ? t("apply.dyn.locating") : t("apply.dyn.useLocation")}
      </button>

      {note && (
        <p role="status" className="mt-1.5 text-xs text-brand-ink/55">
          {note}
        </p>
      )}
    </FieldFrame>
  );
}
