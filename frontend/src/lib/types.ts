export type Lang = "en" | "ta";

export interface Hospital {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  timezone: string;
  reminder_send_time: string;
  default_language: Lang;
  slot_minutes: number;
  booking_window_days: number;
  booking_enabled: boolean;
  is_active: boolean;
  is_demo: boolean;
  today: string;
  now: string;
  demo_clock: string | null;
}

export interface Me {
  id: string;
  email: string;
  full_name: string;
  role: "system_admin" | "hospital_admin" | "hospital_staff";
  role_name: string;
  permissions: string[];
  hospital: Hospital | null;
}

export interface PatientBrief {
  id: string;
  full_name: string;
  phone: string;
  preferred_language: Lang;
  whatsapp_consent: boolean;
  is_demo: boolean;
}

export interface Patient extends PatientBrief {
  consent_at: string | null;
  consent_source: string | null;
  created_at: string;
  appointments?: number;
  last_visit?: string | null;
}

export interface Availability {
  weekday: number;
  start_time: string;
  end_time: string;
  slot_minutes: number | null;
}

export interface Doctor {
  id: string;
  name: string;
  specialty: string | null;
  is_active: boolean;
  availability?: Availability[];
  weekdays?: number[];
}

export type AppointmentStatus = "booked" | "confirmed" | "reschedule_requested" | "cancelled" | "completed" | "no_show";
export type FollowUpStatus = "scheduled" | "confirmed" | "rescheduled" | "completed" | "missed" | "cancelled";

export interface Reminder {
  id: string;
  kind: "appointment_1d" | "followup_7d" | "followup_3d";
  status: "pending" | "processing" | "sent" | "failed" | "cancelled" | "skipped";
  scheduled_for: string;
  target_date: string;
  sent_at: string | null;
  attempts: number;
  last_error: string | null;
  skip_reason: string | null;
  delivery_uncertain: boolean;
  response: "confirmed" | "reschedule_requested" | null;
  responded_at: string | null;
  message_status: string | null;
  simulated: boolean | null;
}

export interface Appointment {
  id: string;
  reference: string;
  date: string;
  start_time: string;
  end_time: string;
  status: AppointmentStatus;
  source: "online" | "staff" | "followup";
  patient: PatientBrief;
  doctor: Doctor;
  followup_id: string | null;
  booked_at: string;
  confirmed_at: string | null;
  confirmed_via: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  completed_at: string | null;
  reschedule_count: number;
  reminder: Reminder | null;
}

export interface FollowUp {
  id: string;
  due_date: string;
  original_due_date: string;
  status: FollowUpStatus;
  attention: "unconfirmed" | "overdue" | null;
  patient: PatientBrief;
  doctor: Doctor;
  source_appointment_id: string;
  confirmed_at: string | null;
  rescheduled_at: string | null;
  completed_at: string | null;
  missed_at: string | null;
  last_contacted_at: string | null;
  contact_count: number;
  reminders: Reminder[];
  visit: { id: string; reference: string; date: string; start_time: string; status: AppointmentStatus } | null;
  contacts?: Contact[];
}

export interface Contact {
  id: string;
  outcome: string;
  note: string | null;
  contacted_at: string;
  by: string | null;
  followup_id?: string;
}

export interface Message {
  id: string;
  direction: "outbound" | "inbound";
  kind: string;
  purpose: string | null;
  language: string | null;
  body: string;
  buttons: { action: "CONFIRM" | "RESCHEDULE"; label: string }[];
  meta: { action_url?: string; action?: string; reminder_kind?: string };
  status: "simulated" | "sent" | "delivered" | "read" | "failed" | "received";
  is_simulated: boolean;
  error_code: string | null;
  error_message: string | null;
  occurred_at: string;
  delivered_at: string | null;
  read_at: string | null;
  reminder_id: string | null;
  patient_id: string | null;
  appointment_id: string | null;
  followup_id: string | null;
  reminder_response?: string | null;
  answerable?: boolean;
  patient_name?: string | null;
}

export interface Slot {
  start_time: string;
  end_time: string;
  available: boolean;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}
