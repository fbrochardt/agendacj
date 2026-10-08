export type Profile = {
  id: string;
  email: string;
  name: string;
  username: string;
  timezone: string;
  role: "admin" | "member";
  created_at: string;
};

export type LocationType = "google_meet" | "in_person" | "phone" | "custom";

export type EventType = {
  id: string;
  user_id: string;
  title: string;
  slug: string;
  description: string | null;
  duration_min: number;
  buffer_min: number;
  min_notice_min: number;
  window_days: number;
  location_type: LocationType;
  location_value: string | null;
  active: boolean;
};

export type AvailabilityRule = {
  weekday: number;
  start_time: string;
  end_time: string;
};

export type CalendarRef = { url: string; name: string };

export type CalendarConnection = {
  id: string;
  user_id: string;
  provider: "google" | "apple";
  account: string;
  secret: string;
  calendars: CalendarRef[];
  destination_calendar: string | null;
  is_destination: boolean;
  last_error: string | null;
};

export type Booking = {
  id: string;
  event_type_id: string | null;
  user_id: string;
  title: string;
  start_at: string;
  end_at: string;
  guest_name: string;
  guest_email: string;
  guest_timezone: string | null;
  notes: string | null;
  status: "confirmed" | "cancelled";
  location: string | null;
  meeting_url: string | null;
  external_provider: string | null;
  external_event_id: string | null;
  external_connection_id: string | null;
  calendar_error: string | null;
  cancel_token: string;
};

export const LOCATION_LABELS: Record<LocationType, string> = {
  google_meet: "Google Meet",
  in_person: "Presencial",
  phone: "Telefone",
  custom: "Outro",
};

export function locationText(et: Pick<EventType, "location_type" | "location_value">): string {
  if (et.location_type === "google_meet") return "Google Meet";
  const v = et.location_value?.trim();
  return v ? v : LOCATION_LABELS[et.location_type];
}

export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export const RESERVED_USERNAMES = new Set([
  "api", "login", "setup", "dashboard", "booking", "admin", "_next", "favicon", "static", "public",
]);
