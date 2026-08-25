# MediFlow

### 🚀 [Live Demo →](https://medicare-unthinkable.onrender.com)

> A full-stack healthcare appointment and consultation platform connecting patients, doctors, and administrators through secure scheduling, AI-assisted summaries, notifications, Google Calendar synchronization, and medication reminders.

## Overview

MediFlow is a healthcare management platform designed to simplify the complete appointment lifecycle between patients and doctors.

The platform provides:

- Secure authentication and role-based access control
- Patient, Doctor, and Admin dashboards
- Doctor availability and appointment scheduling
- Concurrent booking protection
- Appointment holds, cancellation, and rescheduling
- Doctor leave and appointment conflict handling
- AI-powered pre-visit and post-visit summaries
- Email notifications and appointment reminders
- Google Calendar synchronization
- Medication reminder scheduling
- Administrative doctor and appointment management

The application is designed so that failures in optional services such as AI, email, or Google Calendar do not block the core healthcare workflow.

---

## Features

### Authentication & Role-Based Access

MediFlow supports three roles:

- Patient
- Doctor
- Admin

### Patient

Patients can:

- Register and log in
- Browse available doctors
- View available appointment slots
- Hold and book appointments
- Provide symptoms before an appointment
- View AI-generated pre-visit summaries
- View appointment history
- Cancel appointments
- Reschedule appointments
- Connect Google Calendar
- View medication reminders

### Doctor

Doctors can:

- Log in to their account
- View scheduled appointments
- Review patient symptoms
- View AI-generated pre-visit summaries
- Complete consultations
- Add clinical notes
- Add prescriptions
- Add follow-up instructions
- Generate medication reminders
- Connect Google Calendar

### Admin

Administrators can:

- View system statistics
- Create doctors
- Activate or deactivate doctors
- Manage doctor leave
- View appointments
- Filter appointment records
- Manage doctor availability

---

## Appointment Scheduling

MediFlow implements a protected appointment scheduling workflow.

### Booking Flow

```text
Patient
   |
   v
Select Doctor
   |
   v
Select Date
   |
   v
Select Available Slot
   |
   v
Temporary Slot Hold
   |
   v
Enter Symptoms
   |
   v
Confirm Booking
   |
   v
Database Transaction
   |
   +----> Email Notification
   |
   +----> AI Pre-Visit Summary
   |
   +----> Google Calendar Sync
```

### Concurrent Booking Protection

The booking system uses database-level protection to prevent multiple users from successfully booking the same appointment slot.

The system includes:

- Temporary slot holds
- Hold expiration
- Database transactions
- Row-level locking
- Server-side validation

This ensures that appointment availability is protected even when multiple users attempt to book the same slot simultaneously.

---

## AI Integration

MediFlow uses OpenRouter for AI-assisted healthcare workflow features.

### Pre-Visit Summary

Patient symptoms can be processed to generate:

- Urgency level
- Chief complaint
- Three suggested questions for the doctor

Urgency is normalized to:

```text
Low
Medium
High
```

The generated information is intended to assist the clinician and is not a medical diagnosis.

### Post-Visit Summary

After a consultation, MediFlow can convert:

- Clinical notes
- Prescription
- Follow-up instructions

into a patient-friendly summary.

### Model Fallback

The OpenRouter integration uses a fallback strategy.

Primary models:

```text
dots-studio/dots-3-note-preview:free
nvidia/nemotron-3.5-lightning:free
poolside/laguna-s-2.1:free
```

Secondary models:

```text
nvidia/nemotron-3-ultra-550b-a55b:free
nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
```

If AI generation fails, the core appointment and consultation workflow can continue without blocking the user.

---

## Email Notification System

MediFlow uses Nodemailer for email notifications.

Supported notification types include:

- Booking confirmations
- Appointment cancellations
- Rescheduling notifications
- Doctor leave conflict notifications
- 24-hour appointment reminders
- Medication reminders

### Reliability

Email processing is isolated from the core healthcare workflow.

Email failures do not roll back or block:

- Appointment booking
- Cancellation
- Rescheduling
- Consultation completion

The notification system supports:

- Pending notifications
- Sending state
- Sent state
- Failed state
- Automatic retries
- Exponential backoff
- Notification deduplication

SMTP credentials are configured through environment variables and are not exposed to the frontend.

> Production SMTP connectivity should be verified after deployment because hosting providers may have different network restrictions than local development environments.

---

## Google Calendar Integration

MediFlow integrates with Google Calendar using OAuth 2.0.

### Calendar Features

- Connect Google Calendar
- Disconnect Google Calendar
- Check connection status
- Create appointment events
- Update events after rescheduling
- Delete events after cancellation
- Automatically refresh OAuth tokens

### OAuth Flow

```text
MediFlow Account
      |
      v
Connect Google Calendar
      |
      v
Google OAuth Consent
      |
      v
Authorization Code
      |
      v
Backend Token Exchange
      |
      v
Store OAuth Credentials
      |
      v
Calendar Synchronization
```

Calendar failures are isolated from the core appointment workflow.

Sensitive clinical information such as symptoms and clinical notes is not written to Google Calendar events.

---

## Medication Reminder System

Medication reminders are generated after a doctor completes a consultation containing a prescription.

### Example

```text
Paracetamol 650mg - twice daily - 5 days
```

The system stores structured information such as:

```text
Medication: Paracetamol
Dosage: 650mg
Frequency: Twice daily
Duration: 5 days
```

### Supported Frequency Patterns

The deterministic medication parser supports:

```text
Once daily
Twice daily
Three times daily
Four times daily
Every 6 hours
Every 8 hours
Every 12 hours
As needed / PRN
```

PRN instructions do not generate arbitrary reminder times.

### Reminder Scheduler

A background scheduler runs every five minutes and checks for due medication reminders.

The system uses deterministic idempotency keys to prevent duplicate notifications.

Medication courses can transition to `COMPLETED` after their end date.

Cancelled appointments also cancel associated medication reminders.

---

## Database

MediFlow uses PostgreSQL with Drizzle ORM.

Major entities include:

```text
Users
Doctors
Appointments
Appointment Holds
Notification Logs
Google Calendar Tokens
Calendar Events
Medication Reminders
```

The database stores persistent user, appointment, notification, calendar, and medication reminder information.

---

## Security

### Authentication

Authentication uses JWT-based sessions.

### Role-Based Authorization

Protected API endpoints validate the authenticated user's role before allowing sensitive operations.

### Patient Data Isolation

Patients can only access their own protected appointment and medication information.

### Server-Side Secrets

Sensitive credentials are accessed through server-side environment variables.

Examples include:

```text
DATABASE_URL
JWT_SECRET
OPENROUTER_API_KEY
SMTP_PASSWORD
GOOGLE_CLIENT_SECRET
```

These values must never be exposed in the React frontend or committed to GitHub.

### Google OAuth Security

Google Calendar authorization uses signed OAuth state information to associate the OAuth flow with the authenticated MediFlow user.

### Clinical Privacy

Sensitive symptoms and clinical notes are not stored in Google Calendar event descriptions.

---

## Technology Stack

### Frontend

- React
- TypeScript
- Vite
- React Router
- Tailwind CSS
- Lucide React
- Motion

### Backend

- Node.js
- Express
- TypeScript
- PostgreSQL
- Drizzle ORM
- JWT
- bcrypt

### AI

- OpenRouter
- Multiple model fallback strategy

### Notifications

- Nodemailer
- node-cron

### Calendar

- Google APIs
- OAuth 2.0
- Google Calendar API

### Deployment

- Render
- GitHub

---

## Project Structure

```text
.
├── src/
│   ├── components/
│   ├── context/
│   ├── db/
│   ├── lib/
│   │   ├── email.ts
│   │   ├── emailTemplates.ts
│   │   ├── googleCalendar.ts
│   │   ├── medicationParser.ts
│   │   └── ...
│   ├── pages/
│   └── services/
│       └── notificationService.ts
│
├── server.ts
├── index.html
├── package.json
├── README.md
└── .env.example
```

---

## Environment Variables

Create a local `.env` file containing the required configuration.

Example:

```env
DATABASE_URL=
JWT_SECRET=

OPENROUTER_API_KEY=

SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASSWORD=
EMAIL_FROM=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
```

Never commit the actual `.env` file to GitHub.

For production, configure environment variables through the hosting provider.

---

## Local Development

### 1. Clone the repository

```bash
git clone https://github.com/Shikhar-web25/medicare_unthinkable.git
cd medicare_unthinkable
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create:

```text
.env
```

and provide the required values.

### 4. Build

```bash
npm run build
```

### 5. Start

```bash
npm start
```

The application runs locally on:

```text
http://localhost:3000
```

---

## Google Calendar Configuration

To enable Google Calendar:

1. Create a Google Cloud project.
2. Enable the Google Calendar API.
3. Configure the OAuth consent screen.
4. Create OAuth 2.0 credentials.
5. Select `Web application` as the application type.
6. Configure the authorized redirect URI.

For local development:

```text
http://localhost:3000/api/calendar/callback
```

For production:

```text
https://medicare-unthinkable.onrender.com/api/calendar/callback
```

The production redirect URI must also be configured in:

```env
GOOGLE_REDIRECT_URI=
```

---

## Deployment

MediFlow is deployed as a Node.js web service on Render.

### Build Command

```bash
npm install && npm run build
```

### Start Command

```bash
npm start
```

The build generates:

```text
dist/
├── index.html
├── assets/
└── server.cjs
```

Production environment variables should be configured through the hosting provider.

The application should never depend on a committed `.env` file.

---

## API Overview

### Authentication

```text
POST /api/auth/register
POST /api/auth/login
```

### Doctors

```text
GET /api/doctors
GET /api/doctors/:id/available
```

### Appointments

```text
GET  /api/appointments
GET  /api/appointments/:id
POST /api/appointments/hold
POST /api/appointments/book
POST /api/appointments/:id/cancel
POST /api/appointments/:id/reschedule
POST /api/appointments/:id/complete
```

### Medication

```text
GET /api/medications/reminders
```

### Google Calendar

```text
GET  /api/calendar/connect
GET  /api/calendar/callback
GET  /api/calendar/status
POST /api/calendar/disconnect
```

Administrative endpoints are protected by role-based authorization.

---

## Testing

### Medication Reminder Tests

The medication reminder test suite contains 16 scenarios covering:

- Reminder creation
- Multiple medications
- Consultations without prescriptions
- PRN safety
- Scheduler execution
- Duplicate prevention
- Email failure isolation
- Course expiration
- Appointment cancellation
- Duplicate consultation completion
- Patient data isolation
- Authorization

Latest reported result:

```text
16 / 16 tests passed
```

### Google Calendar Tests

The Google Calendar integration test suite contains 10 scenarios covering:

- OAuth state generation
- Calendar connection state
- Event creation
- Duplicate prevention
- Rescheduling
- Cancellation
- Disconnect
- Failure isolation

Latest reported result:

```text
10 / 10 tests passed
```

### Production Build

The latest production build completed successfully with zero build errors.

```bash
npm run build
```

---

## Reliability & Failure Isolation

External services are intentionally isolated from the core appointment workflow.

```text
                 ┌── OpenRouter
                 │
Appointment ─────┼── Email
                 │
                 └── Google Calendar
                         |
                         v
                  Core Database
```

For example:

```text
OpenRouter unavailable
        |
        v
Appointment still succeeds
        |
        v
AI status = UNAVAILABLE
```

Similarly:

```text
Email unavailable
        |
        v
Appointment still succeeds
        |
        v
Notification remains retryable
```

And:

```text
Google Calendar unavailable
        |
        v
Appointment still succeeds
```

This prevents optional external integrations from becoming single points of failure for the core application.

---

## Privacy Considerations

MediFlow is designed to minimize unnecessary exposure of clinical information.

Google Calendar events do not contain:

- Patient symptoms
- Clinical notes
- Prescription details
- AI-generated clinical summaries

API authorization is enforced on the server.

Patient-specific information is only returned to authorized users.

---

## Production Checklist

Before production use, verify:

- [ ] Production database configuration
- [ ] Production environment variables
- [ ] JWT secret
- [ ] OpenRouter API key
- [ ] SMTP configuration and connectivity
- [ ] Google OAuth production redirect URI
- [ ] Google Calendar API configuration
- [ ] HTTPS
- [ ] Database backups
- [ ] Patient data authorization
- [ ] Production appointment booking
- [ ] Email notifications
- [ ] Calendar synchronization
- [ ] Medication reminders

---

## Live Application

**MediFlow:**  
https://medicare-unthinkable.onrender.com

## Repository

**GitHub:**  
https://github.com/Shikhar-web25/medicare_unthinkable

---

## Disclaimer

MediFlow is an educational/software project demonstrating healthcare workflow management.

AI-generated summaries are intended to assist communication and workflow. They are not medical diagnoses or a substitute for professional medical advice.

Medication information and reminders are derived from the prescription entered by the healthcare professional and should not be used to independently determine treatment.

---

## License

This project is licensed under the MIT License.
