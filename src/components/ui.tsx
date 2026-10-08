import { IANAZone } from "luxon";

export function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  return (
    <div
      role="status"
      className={
        "mb-5 rounded-md border px-3.5 py-2.5 text-sm " +
        (error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800")
      }
    >
      {error ?? ok}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

const COMMON_ZONES = [
  "America/Fortaleza", "America/Sao_Paulo", "America/Recife", "America/Bahia", "America/Belem",
  "America/Manaus", "America/Cuiaba", "America/Campo_Grande", "America/Porto_Velho", "America/Boa_Vista",
  "America/Rio_Branco", "America/Noronha", "America/Argentina/Buenos_Aires", "America/Santiago",
  "America/Bogota", "America/Mexico_City", "America/New_York", "America/Chicago", "America/Denver",
  "America/Los_Angeles", "Europe/Lisbon", "Europe/London", "Europe/Madrid", "Europe/Paris", "Europe/Berlin",
  "Africa/Luanda", "Africa/Maputo", "Asia/Dubai", "Asia/Tokyo", "Australia/Sydney", "UTC",
];

export function TimezoneSelect({ name, defaultValue }: { name: string; defaultValue: string }) {
  let zones: string[] = COMMON_ZONES;
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    /* ambiente sem a lista completa */
  }
  if (!zones.includes(defaultValue) && IANAZone.isValidZone(defaultValue)) zones = [defaultValue, ...zones];
  return (
    <select name={name} defaultValue={defaultValue} className="input">
      {zones.map((z) => (
        <option key={z} value={z}>
          {z.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}

export type Search = Promise<{ ok?: string; error?: string }>;
