"""Role and permission catalogue. Seeded into the roles/permissions tables by migration and seed scripts."""

SYSTEM_ADMIN = "system_admin"
HOSPITAL_ADMIN = "hospital_admin"
HOSPITAL_STAFF = "hospital_staff"

PERMISSIONS: dict[str, str] = {
    # platform
    "platform.hospitals.manage": "Create, onboard and suspend hospital accounts",
    "platform.settings.manage": "Manage platform-level configuration",
    "platform.status.view": "Monitor system status",
    # hospital
    "hospital.profile.manage": "Edit hospital profile and booking settings",
    "hospital.staff.manage": "Manage staff accounts",
    "hospital.schedule.manage": "Manage doctors and appointment schedules",
    "hospital.whatsapp.manage": "Configure WhatsApp integration and message templates",
    "hospital.reports.view": "View and export monthly reports",
    "hospital.audit.view": "View the audit log",
    "hospital.demo.control": "Use demo controls (demo hospitals only)",
    # operations
    "appointments.view": "View appointments",
    "appointments.manage": "Register appointments and update their status",
    "patients.view": "View patient records",
    "patients.manage": "Edit patient contact details and consent",
    "followups.view": "View follow-ups, including missed follow-ups",
    "followups.manage": "Schedule follow-ups and update their status",
    "messages.view": "View WhatsApp conversations and delivery status",
    "messages.retry": "Retry failed reminders",
}

_OPERATIONS = [
    "appointments.view", "appointments.manage", "patients.view", "patients.manage",
    "followups.view", "followups.manage", "messages.view", "messages.retry",
]

ROLES: dict[str, dict] = {
    SYSTEM_ADMIN: {
        "name": "System Admin",
        "permissions": ["platform.hospitals.manage", "platform.settings.manage", "platform.status.view"],
    },
    HOSPITAL_ADMIN: {
        "name": "Hospital Admin",
        "permissions": _OPERATIONS + [
            "hospital.profile.manage", "hospital.staff.manage", "hospital.schedule.manage",
            "hospital.whatsapp.manage", "hospital.reports.view", "hospital.audit.view",
            "hospital.demo.control",
        ],
    },
    HOSPITAL_STAFF: {
        "name": "Hospital Staff",
        "permissions": list(_OPERATIONS),
    },
}
