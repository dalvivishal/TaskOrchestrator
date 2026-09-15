# Multi-Agent Task Orchestrator

A full-stack application where a user submits a plain-English request and a **CrewAI crew** of
four specialized agents researches it, drafts a document, and dispatches it. Every agent step is
streamed into the database as an execution log, and the resulting draft lands in a rich-text
editor where a human reviews, edits, and approves it before anything is considered final.

**Stack:** FastAPI + CrewAI + SQLAlchemy + MySQL + JWT auth •
React 19 + TypeScript + Vite + Tailwind CSS 4 + React Quill

---

## Table of Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [The agent crew](#the-agent-crew)
- [Data model](#data-model)
- [Authentication design](#authentication-design)
- [Prerequisites](#prerequisites)
- [Backend setup](#backend-setup)
- [Frontend setup](#frontend-setup)
- [API reference](#api-reference)
- [Frontend routes](#frontend-routes)
- [Project layout](#project-layout)
- [Security notes](#security-notes)
- [Known limitations](#known-limitations)
- [Troubleshooting](#troubleshooting)

---

## What it does

1. A user registers and logs in. They receive a short-lived JWT access token plus an HttpOnly
   refresh cookie.
2. From the dashboard they submit a prompt, for example
   *"Research current AI trends and draft an email to investors."*
3. A `Job` row is created with status `PENDING` and the crew is kicked off in a FastAPI
   background task, so the HTTP request returns immediately.
4. The crew runs sequentially — research, then writing, then dispatch. A `step_callback` writes
   each agent step to `agent_logs` as it happens.
5. The dashboard polls every 5 seconds, so the job's status moves `PENDING` →
   `IN_PROGRESS` → `COMPLETED` / `FAILED` in the UI without a refresh.
6. The final crew output is saved as a `Document` with status `DRAFT`.
7. On the job detail page the user watches the live agent log, edits the draft in a Quill
   editor, and saves it as `APPROVED` or `SENT`.

The human-in-the-loop approval step is the point: the agents never ship anything a person has not
seen.

---

## Architecture

```
  React 19 + Vite + Tailwind 4  (localhost:5173)
  +----------------------------------------------------------+
  |  Login.tsx     Dashboard.tsx        JobDetail.tsx         |
  |  register/     prompt form +        live agent logs +     |
  |  login         job table (5s poll)  Quill editor (5s poll)|
  +----------------------------------------------------------+
        |  api.ts — axios instance
        |    - request interceptor: Bearer <access_token>
        |    - response interceptor: 401 -> POST /auth/refresh -> retry
        v
  FastAPI  (localhost:8000)
  +----------------------------------------------------------+
  |  /auth   register | login | refresh | logout              |
  |  /jobs   create | list | detail | update document         |
  |          (all guarded by get_current_user)                |
  +----------------------------------------------------------+
        |  BackgroundTasks.add_task(run_orchestrator_job, job_id)
        v
  app/agents/crew.py  — CrewAI, Process.sequential
        Manager -> Researcher -> Writer -> Dispatcher
        step_callback --> agent_logs rows
        |
        v
  MySQL: users | jobs | agent_logs | documents
```

---

## The agent crew

Defined in [backend/app/agents/crew.py](backend/app/agents/crew.py). Four agents run under
`Process.sequential`.

| Agent | Role | Tools | Delegation |
|---|---|---|---|
| **Orchestrator Manager** | Understands requests and delegates to the right worker | — | `allow_delegation=True` |
| **Data Researcher** | Gathers information | `web_search_emulator` | off |
| **Document Writer** | Drafts the document from the research | — | off |
| **Communication Dispatcher** | Delivers via email or physical mail | `mock_gmail_sender`, `mock_click2mail_dispatcher` | off |

### Tasks

The three tasks are fixed and run in order:

1. *"Analyze this request and extract required research: {job.prompt}"* → Researcher
2. *"Draft a professional document or email body using the research data."* → Writer
3. *"If the prompt requires sending an email or letter, use the dispatcher tools..."* → Dispatcher

### Tools are simulations

All three tools in [backend/app/agents/tools.py](backend/app/agents/tools.py) are **mocks**. They
accept realistic arguments and return success strings without touching a network:

```python
@tool("Mock Gmail Sender")
def mock_gmail_sender(email_address: str, subject: str, body: str) -> str:
    """Sends an email using a simulated Gmail API. ..."""
    return f"Successfully sent email to {email_address} with subject '{subject}'"
```

Nothing is actually sent or searched. To go live, replace the bodies with real Gmail API,
Click2Mail API, and search-provider calls — the tool signatures and docstrings can stay exactly
as they are, since those are what the agents reason over.

### Step logging

`step_callback` stringifies each CrewAI step and inserts an `AgentLog` row, truncated to 1000
characters. This is what powers the live execution feed on the job detail page.

### Failure handling

The whole crew run is wrapped in `try/except`. On any exception the job is marked `FAILED` and
the error string is written as an `AgentLog` row with `agent_name="System"`, so failures are
visible in the same feed as successes.

---

## Data model

[backend/app/database/models.py](backend/app/database/models.py):

### `users`
| Column | Type | Notes |
|---|---|---|
| `id` | Integer | primary key |
| `username` | String(50) | unique, indexed |
| `hashed_password` | String(255) | bcrypt |

### `jobs`
| Column | Type | Notes |
|---|---|---|
| `id` | Integer | primary key |
| `user_id` | Integer | FK to `users.id` |
| `prompt` | Text | required |
| `status` | Enum | `PENDING` / `IN_PROGRESS` / `COMPLETED` / `FAILED` |
| `created_at` / `updated_at` | DateTime | `updated_at` has `onupdate` |

### `agent_logs`
| Column | Type | Notes |
|---|---|---|
| `id` | Integer | primary key |
| `job_id` | Integer | FK to `jobs.id` |
| `agent_name` | String(50) | `"CrewAI Agent"` or `"System"` on error |
| `action` | String(255) | e.g. `"Executed Step"` |
| `payload` | Text | step output, truncated to 1000 chars |
| `created_at` | DateTime | |

### `documents`
| Column | Type | Notes |
|---|---|---|
| `id` | Integer | primary key |
| `job_id` | Integer | FK to `jobs.id`, one-to-one (`uselist=False`) |
| `content` | Text | the draft, edited in Quill |
| `status` | String(50) | `DRAFT` / `APPROVED` / `SENT` |
| `created_at` / `updated_at` | DateTime | |

Relationships: `User 1-N Job`, `Job 1-N AgentLog`, `Job 1-1 Document`.

Tables are created automatically at startup via `models.Base.metadata.create_all(bind=db.engine)`
in `main.py` — there are no migrations.

---

## Authentication design

A two-token scheme implemented in [backend/app/core/security.py](backend/app/core/security.py)
and [frontend/src/api.ts](frontend/src/api.ts).

| Token | Lifetime | Storage | Purpose |
|---|---|---|---|
| Access token | 15 minutes | `localStorage` | Sent as `Authorization: Bearer ...` on every request |
| Refresh token | 7 days | HttpOnly cookie, `samesite=lax` | Mints new access tokens; unreadable from JS |

Passwords are hashed with `bcrypt.hashpw()` using a per-password `gensalt()`.

The axios response interceptor makes expiry invisible to the user:

```
request -> 401 -> POST /auth/refresh (cookie sent automatically)
        -> new access token -> store -> retry the original request
        -> refresh also fails? -> clear token, redirect to /login
```

An `_retry` flag on the original request config prevents an infinite refresh loop.

---

## Prerequisites

- **Python 3.10+**
- **Node.js 18+** (Vite 8, React 19, Tailwind 4)
- **MySQL 8+** running locally
- An **OpenAI API key** — CrewAI needs a real key for the agents to actually reason

---

## Backend setup

### 1. Create the database

```sql
CREATE DATABASE task_orchestrator CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 2. Point the app at it

The connection string is currently hardcoded in
[backend/app/database/db.py](backend/app/database/db.py):

```python
SQLALCHEMY_DATABASE_URL = "mysql+pymysql://root:Neural%40123@localhost/task_orchestrator"
```

Edit it for your own credentials, or — strongly preferred — move it to an environment variable:

```python
import os
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "mysql+pymysql://...")
```

Note that `%40` is a URL-encoded `@`. Any special character in your password needs the same
treatment.

### 3. Install dependencies

This project ships **no `requirements.txt`**. Install directly:

```bash
cd TaskOrchestrator/backend

python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate

pip install fastapi uvicorn[standard] sqlalchemy pymysql \
            crewai crewai-tools \
            pyjwt bcrypt python-dotenv python-multipart pydantic

pip freeze > requirements.txt     # lock it for next time
```

### 4. Set the OpenAI key

Create `backend/.env`:

```
OPENAI_API_KEY=sk-...
```

`crew.py` loads it with `python-dotenv`. If the variable is absent it falls back to
`sk-mock-key-for-testing` purely so the module imports cleanly — **any job you run without a real
key will fail** during the first agent call.

### 5. Run

```bash
uvicorn app.main:app --reload --port 8000
```

Swagger UI: <http://localhost:8000/docs>

---

## Frontend setup

```bash
cd TaskOrchestrator/frontend
npm install
npm run dev
```

Opens on <http://localhost:5173> — which is exactly the origin allowlisted by the backend's CORS
middleware, so do not change the port without updating `allow_origins` in `main.py`.

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | `tsc -b` type-check, then a production bundle |
| `npm run preview` | Serve the production build |
| `npm run lint` | [oxlint](https://oxc.rs) |

---

## API reference

Base URL: `http://localhost:8000`

### Auth — `/auth`

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/auth/register` | `{username, password}` | `{message}`; `400` if the username is taken |
| `POST` | `/auth/login` | `{username, password}` | `{access_token, token_type, username}` + sets the refresh cookie; `401` on bad credentials |
| `POST` | `/auth/refresh` | — (refresh cookie) | `{access_token, token_type}`; `401` if the cookie is missing or invalid |
| `POST` | `/auth/logout` | — | `{message}`; clears the refresh cookie |

```bash
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username": "vishal", "password": "secret123"}'
```

### Jobs — `/jobs` (all require `Authorization: Bearer <access_token>`)

#### `POST /jobs/`
```json
{ "prompt": "Research current AI trends and draft an email to investors" }
```
Creates the job and schedules the crew as a background task. Returns immediately:
```json
{ "message": "Job started", "job_id": 7 }
```

#### `GET /jobs/`
Lists the authenticated user's jobs, newest first. Users only ever see their own rows — the
query filters on `user_id`.

```json
[{ "id": 7, "prompt": "...", "status": "COMPLETED", "created_at": "2026-09-15T08:14:22" }]
```

#### `GET /jobs/{job_id}`
Full detail — job, all agent logs, and the document if one exists.

```json
{
  "id": 7,
  "prompt": "...",
  "status": "COMPLETED",
  "created_at": "2026-09-15T08:14:22",
  "logs": [{ "agent": "CrewAI Agent", "action": "Executed Step", "payload": "...", "created_at": "..." }],
  "document": { "id": 3, "content": "...", "status": "DRAFT" }
}
```

#### `PUT /jobs/{job_id}/document`
```json
{ "content": "<p>Edited HTML from Quill</p>", "status": "APPROVED" }
```
Saves the human-reviewed draft. `status` is free text; the UI uses `DRAFT`, `APPROVED`, `SENT`.

> Both `GET /jobs/{id}` and `PUT /jobs/{id}/document` return `{"error": "..."}` with HTTP **200**
> when the job is missing, rather than a `404`. Client code must check the response body, not just
> the status code.

---

## Frontend routes

| Route | Component | Guard |
|---|---|---|
| `/login` | `Login.tsx` — combined login/register toggle | public |
| `/dashboard` | `Dashboard.tsx` — prompt form + job table, polls every 5 s | redirects to `/login` without a token |
| `/jobs/:id` | `JobDetail.tsx` — agent log feed + Quill editor, polls every 5 s | redirects to `/login` without a token |
| `/` | redirect to `/dashboard` or `/login` | — |

Status icons on the dashboard: green check for `COMPLETED`, red X for `FAILED`, a spinning clock
for `IN_PROGRESS`, a grey clock for `PENDING`.

The route guard reads `localStorage` once at `App` render, so a token expiring mid-session does
not immediately bounce the user — the axios interceptor handles that on the next request.

---

## Project layout

```
TaskOrchestrator/
├── backend/
│   └── app/
│       ├── agents/
│       │   ├── crew.py          # 4 agents, 3 tasks, step_callback, job status transitions
│       │   └── tools.py         # 3 mock @tool implementations
│       ├── api/
│       │   ├── auth.py          # register / login / refresh / logout
│       │   ├── dependencies.py  # get_current_user via OAuth2PasswordBearer
│       │   └── jobs.py          # job CRUD + document update
│       ├── core/security.py     # bcrypt hashing, JWT create/decode
│       ├── database/
│       │   ├── db.py            # engine, SessionLocal, Base, get_db()
│       │   └── models.py        # User, Job, AgentLog, Document
│       └── main.py              # app, CORS, create_all, routers
└── frontend/
    ├── src/
    │   ├── api.ts               # axios + auth/refresh interceptors
    │   ├── App.tsx              # router, header, logout
    │   ├── Login.tsx
    │   ├── Dashboard.tsx
    │   ├── JobDetail.tsx
    │   └── index.css
    ├── package.json
    └── vite.config.ts           # react + @tailwindcss/vite
```

---

## Security notes

Several values in this repo are development defaults and **must** change before any deployment:

| Item | Location | Problem |
|---|---|---|
| `SECRET_KEY = "super_secret_orchestrator_key"` | `core/security.py` | Committed JWT signing key — anyone with the repo can forge tokens. Load from the environment and rotate. |
| MySQL root credentials in the URL | `database/db.py` | Committed password, and running as `root`. Move to `DATABASE_URL` and use a least-privilege account. |
| Access token in `localStorage` | `frontend/src/api.ts` | Readable by any XSS payload. The 15-minute lifetime limits the blast radius; the refresh token is correctly HttpOnly. |
| No password policy | `api/auth.py` | Any non-empty string is accepted at registration. |
| No rate limiting | `/auth/login` | Unlimited credential-stuffing attempts. |

The multi-tenancy boundary itself is sound: every job query filters on `current_user.id`, so one
user cannot read or modify another's jobs or documents.

---

## Known limitations

**No `requirements.txt`.** Dependencies must be installed by hand — see
[Backend setup](#backend-setup). Generate and commit one.

**No `__init__.py` files** in the `app` package tree. It works on Python 3.3+ via implicit
namespace packages, but adding them makes imports more predictable across tooling.

**No migrations.** Schema changes require dropping tables or adding Alembic.

**Background tasks are in-process.** `BackgroundTasks` runs the crew inside the uvicorn worker.
A restart kills any in-flight job, leaving it stuck at `IN_PROGRESS` forever. A real deployment
wants Celery or RQ with a broker.

**Polling, not streaming.** Both the dashboard and the detail page poll every 5 seconds. Server-
sent events or a WebSocket would give a true live feed and cut the request volume.

**Fixed task pipeline.** Despite the Manager agent having `allow_delegation=True`, the three tasks
are hardcoded and always run in the same order — the code comment acknowledges this. True dynamic
planning would have the manager decompose the prompt into tasks at runtime.

**All dispatch tools are mocks.** Nothing is emailed, mailed, or searched. See
[Tools are simulations](#tools-are-simulations).

**Quill content is stored raw.** `JobDetail` saves the editor's HTML straight to the database and
renders it back. Sanitize it (DOMPurify on the client, bleach on the server) before rendering
content that could come from another user.

**`datetime.utcnow()` is deprecated** in Python 3.12+. Replace with
`datetime.now(timezone.utc)` in `models.py` and `core/security.py`.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Can't connect to MySQL server` | MySQL is not running, or the credentials in `db.py` do not match. Verify with `mysql -u root -p`. |
| `Unknown database 'task_orchestrator'` | Run the `CREATE DATABASE` statement above. |
| `ModuleNotFoundError: No module named 'pymysql'` | `pip install pymysql` — SQLAlchemy needs the driver named in the URL. |
| Job goes straight to `FAILED` | Almost always a missing or invalid `OPENAI_API_KEY`. Open the job detail page — the error text is in the `System` log row. |
| Job sits at `IN_PROGRESS` forever | The uvicorn worker restarted mid-run (`--reload` does this on every file save). Re-submit. |
| CORS errors in the browser console | The frontend is not on port 5173. Update `allow_origins` in `main.py`. |
| Login succeeds, next request 401s | The refresh cookie is not being sent. `withCredentials: true` must be set (it is, in `api.ts`) and the backend must not be on a different host. |
| `ModuleNotFoundError: app` | Run uvicorn from `backend/`, not from the repo root. |
