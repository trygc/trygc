import {
  type FormEvent,
  startTransition,
  useEffect,
  useState,
} from "react";

const runtimeConfig = globalThis as typeof globalThis & {
  __TRYGC_PROJECT_ID__?: string;
  __TRYGC_SUPABASE_URL__?: string;
  __TRYGC_SUPABASE_ANON_KEY__?: string;
};

const viteEnv = import.meta.env;

const DEFAULT_PROJECT_ID = "tabwjvmkvqhimlrszbwh";
const DEFAULT_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRhYndqdm1rdnFoaW1scnN6YndoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNjExNDgsImV4cCI6MjA4NzgzNzE0OH0.9PN-Fq77HSRXJ_ZrFGb_xZbKkn0KH5ZFNtAn6larwZM";

const PROJECT_ID =
  runtimeConfig.__TRYGC_PROJECT_ID__?.trim() ||
  viteEnv.VITE_TRYGC_PROJECT_ID?.trim() ||
  DEFAULT_PROJECT_ID;

const SUPABASE_URL =
  runtimeConfig.__TRYGC_SUPABASE_URL__?.trim() ||
  viteEnv.VITE_TRYGC_SUPABASE_URL?.trim() ||
  `https://${PROJECT_ID}.supabase.co`;

const SUPABASE_ANON_KEY =
  runtimeConfig.__TRYGC_SUPABASE_ANON_KEY__?.trim() ||
  viteEnv.VITE_TRYGC_SUPABASE_ANON_KEY?.trim() ||
  DEFAULT_SUPABASE_ANON_KEY;

function isBackendConfigured() {
  return Boolean(PROJECT_ID && SUPABASE_ANON_KEY);
}

const EDGE_BASE_URL = `${SUPABASE_URL}/functions/v1/make-server-b626472b`;
const SESSION_STORAGE_KEY = "trygc-figma-session";
const APP_VIEWS = [
  { id: "personal", label: "My Dashboard" },
  { id: "campaigns", label: "Campaigns" },
  { id: "community-team", label: "Community Team" },
  { id: "user-management", label: "User Management" },
  { id: "settings", label: "Settings" },
] as const;

type AuthMode = "login" | "signup";
type ActiveAction = "config" | "export" | "logout" | "refresh" | null;

type AppUser = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown> | null;
};

type AppSession = {
  access_token: string;
  expires_at?: number;
  expires_in?: number;
  refresh_token: string;
  token_type: string;
  user: AppUser;
};

type WorkspaceData = {
  mistakes: Array<Record<string, unknown>>;
  opsCampaigns: Array<Record<string, unknown>>;
  successLogs: Array<Record<string, unknown>>;
  taskNotifications: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  tasksPerTeam?: Record<string, unknown>;
};

type CommunityData = {
  checklists: Array<Record<string, unknown>>;
  countries: Array<Record<string, unknown>>;
  updatedAt?: string;
  version?: number;
};

type TeamMember = {
  email?: string;
  features?: string[];
  name?: string;
  role?: string;
  teamName?: string;
};

type AdminConfig = {
  adminEmails?: string[];
  appConfiguration?: Record<string, unknown>;
  teamMembers?: TeamMember[];
};

type AccessPayload = {
  config?: AdminConfig;
  demoCompleted?: boolean;
  features?: string[];
  role?: string;
};

function toErrorMessage(payload: unknown, fallback: string) {
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;

    for (const key of ["msg", "message", "error_description", "error"]) {
      const value = record[key];

      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }
  }

  return fallback;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function normalizeSession(session: AppSession): AppSession {
  return {
    ...session,
    expires_at:
      session.expires_at ??
      Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600),
  };
}

function readStoredSession() {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? normalizeSession(JSON.parse(raw) as AppSession) : null;
  } catch {
    return null;
  }
}

function storeSession(session: AppSession) {
  window.localStorage.setItem(
    SESSION_STORAGE_KEY,
    JSON.stringify(normalizeSession(session)),
  );
}

function clearStoredSession() {
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
}

function isSessionExpiring(session: AppSession) {
  return (session.expires_at ?? 0) * 1000 <= Date.now() + 60_000;
}

function getDisplayName(user: AppUser | null) {
  const metadata = user?.user_metadata;
  if (typeof metadata?.name === "string" && metadata.name.trim()) {
    return metadata.name;
  }
  if (typeof metadata?.full_name === "string" && metadata.full_name.trim()) {
    return metadata.full_name;
  }
  return user?.email || "Unknown user";
}

async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  fallbackMessage = "Request failed",
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("apikey", SUPABASE_ANON_KEY);

  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  const payload = text ? safeJsonParse(text) : null;

  if (!response.ok) {
    throw new Error(
      toErrorMessage(payload, `${fallbackMessage} (${response.status})`),
    );
  }

  return payload as T;
}

async function signInWithPassword(email: string, password: string) {
  const session = await requestJson<AppSession>(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      body: JSON.stringify({ email, password }),
    },
    "Sign in failed",
  );

  return normalizeSession(session);
}

async function refreshStoredSession(refreshToken: string) {
  const session = await requestJson<AppSession>(
    `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    },
    "Session refresh failed",
  );

  return normalizeSession(session);
}

async function fetchCurrentUser(session: AppSession) {
  return requestJson<AppUser>(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${session.access_token}` },
    },
    "Failed to validate session",
  );
}

async function signUpWithPassword(
  email: string,
  password: string,
  name: string,
) {
  await requestJson(
    `${EDGE_BASE_URL}/signup`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ email, password, name }),
    },
    "Sign up failed",
  );
}

async function signOut(session: AppSession) {
  await requestJson(
    `${SUPABASE_URL}/auth/v1/logout`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    },
    "Sign out failed",
  );
}

function downloadJsonFile(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

function asArray<T>(value: T[] | undefined | null) {
  return Array.isArray(value) ? value : [];
}

function readText(value: unknown, fallback = "Untitled") {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

const styles = `
  :root {
    color: #0a0a0a;
    font-family: Inter, "Segoe UI", system-ui, sans-serif;
  }

  * {
    box-sizing: border-box;
  }

  body {
    margin: 0;
  }

  button,
  input {
    font: inherit;
  }

  .trygc-login-screen {
    position: relative;
    display: flex;
    min-height: 100vh;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: #ffffff;
    color: #0a0a0a;
    padding: 16px;
  }

  .trygc-login-screen__glow {
    pointer-events: none;
    position: absolute;
    inset: 0;
    overflow: hidden;
  }

  .trygc-login-screen__orb {
    position: absolute;
    height: 500px;
    width: 500px;
    border-radius: 999px;
    filter: blur(48px);
  }

  .trygc-login-screen__orb--top {
    top: -128px;
    right: -128px;
    background: rgba(0, 0, 0, 0.12);
  }

  .trygc-login-screen__orb--bottom {
    bottom: -128px;
    left: -128px;
    background: rgba(0, 0, 0, 0.08);
  }

  .trygc-login-screen__dots {
    position: absolute;
    inset: 0;
    opacity: 0.03;
    background-image: radial-gradient(circle, currentColor 1px, transparent 1px);
    background-size: 32px 32px;
  }

  .trygc-login-screen__content {
    position: relative;
    z-index: 1;
    width: 100%;
    max-width: 420px;
  }

  .trygc-login-screen__hero {
    margin-bottom: 32px;
    text-align: center;
  }

  .trygc-login-screen__badge {
    margin: 0 auto 20px;
    display: inline-flex;
    height: 56px;
    width: 56px;
    align-items: center;
    justify-content: center;
    border-radius: 20px;
    background: #000000;
    color: #ffffff;
    box-shadow: rgba(0, 0, 0, 0.25) 0 25px 50px -12px;
    transform: rotate(-3deg);
  }

  .trygc-login-screen__title {
    margin: 0;
    font-size: 24px;
    line-height: 1.2;
    font-weight: 900;
    letter-spacing: -0.6px;
    color: #18181b;
  }

  .trygc-login-screen__subtitle {
    margin: 6px 0 0;
    font-size: 14px;
    line-height: 1.4;
    font-weight: 500;
    color: #a1a1aa;
  }

  .trygc-login-card {
    border-radius: 24px;
    background: #ffffff;
    padding: 28px;
    box-shadow: rgba(0, 0, 0, 0.25) 0 25px 50px -12px;
  }

  .trygc-login-form {
    display: grid;
    gap: 16px;
  }

  .trygc-field {
    display: grid;
    gap: 6px;
  }

  .trygc-field__label {
    font-size: 12px;
    line-height: 1;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #71717a;
  }

  .trygc-field__control {
    position: relative;
  }

  .trygc-field__icon {
    pointer-events: none;
    position: absolute;
    top: 50%;
    left: 14px;
    display: flex;
    transform: translateY(-50%);
    color: #a1a1aa;
  }

  .trygc-field__input {
    width: 100%;
    border: 1px solid #e4e4e7;
    border-radius: 16px;
    background: #fafafa;
    padding: 12px 16px 12px 40px;
    font-size: 14px;
    line-height: 1.4;
    font-weight: 500;
    color: #27272a;
    outline: none;
    transition:
      border-color 0.15s ease,
      box-shadow 0.15s ease,
      background-color 0.15s ease;
  }

  .trygc-field__input::placeholder {
    color: #a1a1aa;
  }

  .trygc-field__input:focus {
    border-color: #18181b;
    box-shadow: 0 0 0 3px rgba(24, 24, 27, 0.1);
    background: #ffffff;
  }

  .trygc-field__input--password {
    padding-right: 44px;
  }

  .trygc-field__toggle {
    position: absolute;
    top: 50%;
    right: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    transform: translateY(-50%);
    border: 0;
    background: transparent;
    color: #a1a1aa;
    padding: 0;
    transition: color 0.15s ease;
  }

  .trygc-field__toggle:hover {
    color: #52525b;
  }

  .trygc-login-form__submit {
    margin-top: 8px;
    display: inline-flex;
    width: 100%;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 0;
    border-radius: 20px;
    background: #18181b;
    color: #ffffff;
    padding: 14px 0;
    font-size: 14px;
    line-height: 1.4;
    font-weight: 900;
    box-shadow:
      rgba(0, 0, 0, 0.1) 0 10px 15px -3px,
      rgba(0, 0, 0, 0.1) 0 4px 6px -4px;
    transition:
      background-color 0.15s ease,
      box-shadow 0.15s ease,
      transform 0.15s ease;
  }

  .trygc-login-form__submit:hover {
    background: #27272a;
    box-shadow:
      rgba(0, 0, 0, 0.12) 0 20px 25px -5px,
      rgba(0, 0, 0, 0.08) 0 10px 10px -5px;
    transform: translateY(-2px);
  }

  .trygc-login-form__submit:active {
    transform: translateY(0);
  }

  .trygc-login-form__submit:disabled {
    cursor: not-allowed;
    opacity: 0.6;
    transform: none;
  }

  .trygc-login-card__banner {
    margin-bottom: 16px;
    border-radius: 16px;
    padding: 12px 14px;
    font-size: 13px;
    line-height: 1.5;
    font-weight: 600;
  }

  .trygc-login-card__banner--error {
    background: #fef2f2;
    color: #b91c1c;
  }

  .trygc-login-card__banner--success {
    background: #f4f4f5;
    color: #18181b;
  }

  .trygc-session-card {
    display: grid;
    gap: 16px;
  }

  .trygc-session-card__grid {
    display: grid;
    gap: 12px;
    border: 1px solid #e4e4e7;
    border-radius: 20px;
    background: #fafafa;
    padding: 16px;
  }

  .trygc-session-card__row {
    display: grid;
    gap: 4px;
  }

  .trygc-session-card__label {
    font-size: 11px;
    line-height: 1;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #71717a;
  }

  .trygc-session-card__value {
    font-size: 14px;
    line-height: 1.5;
    font-weight: 600;
    color: #18181b;
    word-break: break-word;
  }

  .trygc-session-card__actions {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .trygc-session-card__secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: 1px solid #e4e4e7;
    border-radius: 20px;
    background: #fafafa;
    color: #27272a;
    padding: 14px 16px;
    font-size: 14px;
    line-height: 1.4;
    font-weight: 900;
    transition:
      background-color 0.15s ease,
      border-color 0.15s ease,
      transform 0.15s ease;
  }

  .trygc-session-card__secondary:hover {
    background: #f4f4f5;
    border-color: #d4d4d8;
    transform: translateY(-1px);
  }

  .trygc-session-card__secondary:disabled {
    cursor: not-allowed;
    opacity: 0.6;
    transform: none;
  }

  .trygc-session-card__preview {
    margin: 0;
    max-height: 220px;
    overflow: auto;
    border-radius: 20px;
    background: #0a0a0a;
    color: #f4f4f5;
    padding: 16px;
    font-size: 12px;
    line-height: 1.6;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .trygc-spinner {
    display: inline-flex;
    animation: trygc-spin 0.9s linear infinite;
  }

  .trygc-shell {
    display: grid;
    gap: 16px;
  }

  .trygc-shell__header {
    display: grid;
    gap: 12px;
    border: 1px solid #e4e4e7;
    border-radius: 20px;
    background: #fafafa;
    padding: 16px;
  }

  .trygc-shell__title {
    margin: 0;
    font-size: 22px;
    line-height: 1.2;
    font-weight: 900;
    color: #18181b;
  }

  .trygc-shell__copy {
    margin: 4px 0 0;
    font-size: 13px;
    line-height: 1.5;
    color: #71717a;
  }

  .trygc-shell__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .trygc-shell__pill {
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    background: #ffffff;
    border: 1px solid #e4e4e7;
    padding: 8px 12px;
    font-size: 12px;
    line-height: 1;
    font-weight: 800;
    color: #3f3f46;
  }

  .trygc-shell__tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .trygc-shell__tab {
    border: 1px solid #e4e4e7;
    border-radius: 999px;
    background: #ffffff;
    color: #52525b;
    padding: 10px 14px;
    font-size: 12px;
    line-height: 1;
    font-weight: 900;
    transition:
      background-color 0.15s ease,
      color 0.15s ease,
      border-color 0.15s ease,
      transform 0.15s ease;
  }

  .trygc-shell__tab:hover {
    transform: translateY(-1px);
    border-color: #d4d4d8;
  }

  .trygc-shell__tab--active {
    background: #18181b;
    border-color: #18181b;
    color: #ffffff;
  }

  .trygc-shell__grid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .trygc-shell__panel {
    border: 1px solid #e4e4e7;
    border-radius: 20px;
    background: #fafafa;
    padding: 16px;
  }

  .trygc-shell__panel--full {
    grid-column: 1 / -1;
  }

  .trygc-shell__eyebrow {
    margin: 0 0 8px;
    font-size: 11px;
    line-height: 1;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #71717a;
  }

  .trygc-shell__metric {
    margin: 0;
    font-size: 28px;
    line-height: 1.1;
    font-weight: 900;
    color: #18181b;
  }

  .trygc-shell__submetric {
    margin: 8px 0 0;
    font-size: 13px;
    line-height: 1.5;
    color: #71717a;
  }

  .trygc-shell__list {
    display: grid;
    gap: 10px;
  }

  .trygc-shell__item {
    border-radius: 16px;
    background: #ffffff;
    border: 1px solid #e4e4e7;
    padding: 12px 14px;
  }

  .trygc-shell__item-title {
    margin: 0;
    font-size: 14px;
    line-height: 1.4;
    font-weight: 800;
    color: #18181b;
  }

  .trygc-shell__item-copy {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: #71717a;
  }

  .trygc-shell__item-meta {
    margin-top: 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .trygc-shell__item-pill {
    display: inline-flex;
    border-radius: 999px;
    background: #f4f4f5;
    padding: 6px 10px;
    font-size: 11px;
    line-height: 1;
    font-weight: 800;
    color: #52525b;
  }

  .trygc-shell__empty {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: #71717a;
  }

  .trygc-login-card__footer {
    margin-top: 20px;
    text-align: center;
    font-size: 14px;
    line-height: 1.5;
    color: #71717a;
  }

  .trygc-login-card__link {
    border: 0;
    background: transparent;
    color: #18181b;
    font-size: inherit;
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 2px;
    transition: color 0.15s ease;
  }

  .trygc-login-card__link:hover {
    color: #52525b;
  }

  .trygc-login-screen__caption {
    margin: 24px 0 0;
    text-align: center;
    font-size: 12px;
    line-height: 1.4;
    color: #52525b;
  }

  @keyframes trygc-spin {
    from {
      transform: rotate(0deg);
    }

    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .trygc-spinner {
      animation: none;
    }

    .trygc-login-form__submit,
    .trygc-session-card__secondary,
    .trygc-shell__tab {
      transition: none;
    }
  }

  @media (max-width: 480px) {
    .trygc-login-screen__hero {
      margin-bottom: 28px;
    }

    .trygc-login-card {
      padding: 24px;
    }

    .trygc-session-card__actions {
      grid-template-columns: minmax(0, 1fr);
    }

    .trygc-shell__grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
`;

function ShieldCheckIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="28"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="28"
    >
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="16"
    >
      <rect height="16" rx="2" width="20" x="2" y="4" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="16"
    >
      <rect height="11" rx="2" ry="2" width="18" x="3" y="11" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="M18 21a6 6 0 0 0-12 0" />
      <circle cx="12" cy="8" r="5" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="M10.733 5.076A10.74 10.74 0 0 1 12 5c4.242 0 7.85 2.66 9.338 6.418a1 1 0 0 1 0 .764 10.84 10.84 0 0 1-1.989 3.004" />
      <path d="M14.084 14.158A3 3 0 0 1 9.84 9.916" />
      <path d="M17.479 17.499A10.75 10.75 0 0 1 12 19c-4.242 0-7.85-2.66-9.338-6.418a1 1 0 0 1 0-.764 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      aria-hidden="true"
      className="trygc-spinner"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="16"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

export default function App() {
  const [activeView, setActiveView] =
    useState<(typeof APP_VIEWS)[number]["id"]>("personal");
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [session, setSession] = useState<AppSession | null>(null);
  const [banner, setBanner] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [backendPreview, setBackendPreview] = useState("");
  const [workspaceData, setWorkspaceData] = useState<WorkspaceData | null>(null);
  const [communityData, setCommunityData] = useState<CommunityData | null>(null);
  const [adminConfig, setAdminConfig] = useState<AdminConfig | null>(null);
  const [userRole, setUserRole] = useState("member");
  const [userFeatures, setUserFeatures] = useState<string[]>([]);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const restoreSession = async () => {
      if (!isBackendConfigured()) {
        if (isMounted) {
          setIsCheckingSession(false);
        }
        return;
      }

      const stored = readStoredSession();

      if (!stored) {
        if (isMounted) {
          setIsCheckingSession(false);
        }
        return;
      }

      try {
        const nextSession = isSessionExpiring(stored)
          ? await refreshStoredSession(stored.refresh_token)
          : normalizeSession({
              ...stored,
              user: await fetchCurrentUser(stored),
            });

        storeSession(nextSession);

        if (isMounted) {
          startTransition(() => {
            setSession(nextSession);
          });
        }
      } catch {
        clearStoredSession();
      } finally {
        if (isMounted) {
          setIsCheckingSession(false);
        }
      }
    };

    void restoreSession();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!session?.user.email) {
      setWorkspaceData(null);
      setCommunityData(null);
      setAdminConfig(null);
      setUserRole("member");
      setUserFeatures([]);
      return;
    }

    let isMounted = true;

    const loadWorkspace = async () => {
      setIsWorkspaceLoading(true);

      try {
        const payload = await requestJson<AccessPayload>(
          `${EDGE_BASE_URL}/auto-register`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
            body: JSON.stringify({
              email: session.user.email,
              name: getDisplayName(session.user),
            }),
          },
          "Failed to load user access",
        );

        const [workspace, communityResponse, configResponse] = await Promise.all([
          requestJson<WorkspaceData>(
            `${EDGE_BASE_URL}/data`,
            {
              method: "GET",
              headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
            },
            "Failed to load workspace data",
          ),
          requestJson<{ data: CommunityData }>(
            `${EDGE_BASE_URL}/community-team-data`,
            {
              method: "GET",
              headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
            },
            "Failed to load community team data",
          ),
          requestJson<{ config: AdminConfig }>(
            `${EDGE_BASE_URL}/admin-config`,
            {
              method: "GET",
              headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
            },
            "Failed to load admin config",
          ),
        ]);

        if (!isMounted) {
          return;
        }

        startTransition(() => {
          setWorkspaceData(workspace);
          setCommunityData(communityResponse.data);
          setAdminConfig(payload.config ?? configResponse.config);
          setUserRole(payload.role ?? "member");
          setUserFeatures(asArray(payload.features));
        });
      } catch (error) {
        if (isMounted) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Failed to load workspace data",
          );
        }
      } finally {
        if (isMounted) {
          setIsWorkspaceLoading(false);
        }
      }
    };

    void loadWorkspace();

    return () => {
      isMounted = false;
    };
  }, [session]);

  const resetMessages = () => {
    setBanner("");
    setErrorMessage("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    resetMessages();

    if (!isBackendConfigured()) {
      setErrorMessage(
        "Missing Supabase configuration. Set window.__TRYGC_* or VITE_TRYGC_* build env vars.",
      );
      return;
    }

    setIsSubmitting(true);

    try {
      let nextSession: AppSession;

      if (mode === "login") {
        nextSession = await signInWithPassword(email, password);
      } else {
        await signUpWithPassword(email, password, fullName.trim());
        nextSession = await signInWithPassword(email, password);
        setBanner("Account created successfully.");
      }

      storeSession(nextSession);
      setPassword("");
      setBackendPreview("");

      startTransition(() => {
        setSession(nextSession);
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Authentication failed",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRefreshSession = async () => {
    if (!session) {
      return;
    }

    resetMessages();
    setActiveAction("refresh");

    try {
      const nextSession = await refreshStoredSession(session.refresh_token);
      storeSession(nextSession);
      setBanner("Session refreshed.");
      startTransition(() => {
        setSession(nextSession);
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Session refresh failed",
      );
    } finally {
      setActiveAction(null);
    }
  };

  const handleLoadWorkspaceConfig = async () => {
    resetMessages();
    setActiveAction("config");

    try {
      const payload = await requestJson<Record<string, unknown>>(
        `${EDGE_BASE_URL}/admin-config`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        },
        "Failed to load workspace config",
      );
      setBackendPreview(JSON.stringify(payload, null, 2));
      setBanner("Workspace config loaded from the live backend.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to load workspace config",
      );
    } finally {
      setActiveAction(null);
    }
  };

  const handleExportData = async () => {
    resetMessages();
    setActiveAction("export");

    try {
      const payload = await requestJson<Record<string, unknown>>(
        `${EDGE_BASE_URL}/export-data`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
        },
        "Failed to export data",
      );
      setBackendPreview(JSON.stringify(payload, null, 2));
      downloadJsonFile(payload, `trygc-export-${Date.now()}.json`);
      setBanner("Workspace export downloaded.");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to export data",
      );
    } finally {
      setActiveAction(null);
    }
  };

  const handleLogout = async () => {
    if (!session) {
      return;
    }

    resetMessages();
    setActiveAction("logout");

    try {
      await signOut(session);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Sign out failed");
    } finally {
      clearStoredSession();
      setBackendPreview("");
      setEmail("");
      setFullName("");
      setPassword("");
      setMode("login");
      startTransition(() => {
        setSession(null);
      });
      setActiveAction(null);
    }
  };

  const handleModeSwitch = () => {
    resetMessages();
    setMode((current) => (current === "login" ? "signup" : "login"));
  };

  const heroTitle =
    isCheckingSession || !session
      ? "Welcome back"
      : "Workspace session active";
  const heroSubtitle =
    isCheckingSession || !session
      ? "Sign in to your workspace"
      : "Connected to the same Supabase backend as the exported build";
  const sessionExpiry = session?.expires_at
    ? new Date(session.expires_at * 1000).toLocaleString()
    : "Unknown";
  const campaigns = asArray(workspaceData?.opsCampaigns);
  const successLogs = asArray(workspaceData?.successLogs);
  const notifications = asArray(workspaceData?.taskNotifications);
  const mistakes = asArray(workspaceData?.mistakes);
  const countries = asArray(communityData?.countries);
  const checklists = asArray(communityData?.checklists);
  const teamMembers = asArray(adminConfig?.teamMembers);
  const featureList = userFeatures.length ? userFeatures.join(", ") : "Default";
  const activeViewLabel =
    APP_VIEWS.find((view) => view.id === activeView)?.label ?? "Workspace";

  return (
    <>
      <style>{styles}</style>

      <main className="trygc-login-screen">
        <div className="trygc-login-screen__glow" aria-hidden="true">
          <div className="trygc-login-screen__orb trygc-login-screen__orb--top" />
          <div className="trygc-login-screen__orb trygc-login-screen__orb--bottom" />
          <div className="trygc-login-screen__dots" />
        </div>

        <div className="trygc-login-screen__content">
          <section className="trygc-login-screen__hero">
            <div className="trygc-login-screen__badge">
              <ShieldCheckIcon />
            </div>
            <h1 className="trygc-login-screen__title">{heroTitle}</h1>
            <p className="trygc-login-screen__subtitle">{heroSubtitle}</p>
          </section>

          <section className="trygc-login-card">
            {errorMessage ? (
              <div className="trygc-login-card__banner trygc-login-card__banner--error">
                {errorMessage}
              </div>
            ) : null}

            {banner ? (
              <div className="trygc-login-card__banner trygc-login-card__banner--success">
                {banner}
              </div>
            ) : null}

            {isCheckingSession ? (
              <div className="trygc-session-card">
                <div className="trygc-session-card__grid">
                  <div className="trygc-session-card__row">
                    <span className="trygc-session-card__label">Status</span>
                    <span className="trygc-session-card__value">
                      Checking session...
                    </span>
                  </div>
                  <div className="trygc-session-card__row">
                    <span className="trygc-session-card__label">Backend</span>
                    <span className="trygc-session-card__value">
                      {SUPABASE_URL}
                    </span>
                  </div>
                </div>

                <button className="trygc-login-form__submit" disabled type="button">
                  <SpinnerIcon />
                  Checking Session
                </button>
              </div>
            ) : session ? (
              <div className="trygc-session-card">
                <div className="trygc-shell">
                  <div className="trygc-shell__header">
                    <div>
                      <p className="trygc-shell__eyebrow">Workspace</p>
                      <h2 className="trygc-shell__title">{activeViewLabel}</h2>
                      <p className="trygc-shell__copy">
                        Signed in as {getDisplayName(session.user)}. This shell
                        is reading the same backend routes the exported build
                        uses.
                      </p>
                    </div>

                    <div className="trygc-shell__meta">
                      <span className="trygc-shell__pill">
                        Role: {userRole || "member"}
                      </span>
                      <span className="trygc-shell__pill">
                        Project: {PROJECT_ID}
                      </span>
                      <span className="trygc-shell__pill">
                        Expires: {sessionExpiry}
                      </span>
                    </div>

                    <div className="trygc-shell__tabs">
                      {APP_VIEWS.map((view) => (
                        <button
                          key={view.id}
                          className={`trygc-shell__tab ${
                            activeView === view.id
                              ? "trygc-shell__tab--active"
                              : ""
                          }`}
                          onClick={() => setActiveView(view.id)}
                          type="button"
                        >
                          {view.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {isWorkspaceLoading ? (
                    <button className="trygc-login-form__submit" disabled type="button">
                      <SpinnerIcon />
                      Loading Workspace
                    </button>
                  ) : null}

                  {activeView === "personal" ? (
                    <div className="trygc-shell__grid">
                      <section className="trygc-shell__panel">
                        <p className="trygc-shell__eyebrow">Campaigns</p>
                        <p className="trygc-shell__metric">{campaigns.length}</p>
                        <p className="trygc-shell__submetric">
                          Live campaign records returned from `/data`.
                        </p>
                      </section>
                      <section className="trygc-shell__panel">
                        <p className="trygc-shell__eyebrow">Updates</p>
                        <p className="trygc-shell__metric">{successLogs.length}</p>
                        <p className="trygc-shell__submetric">
                          Success feed entries available in the workspace.
                        </p>
                      </section>
                      <section className="trygc-shell__panel">
                        <p className="trygc-shell__eyebrow">Notifications</p>
                        <p className="trygc-shell__metric">
                          {notifications.length}
                        </p>
                        <p className="trygc-shell__submetric">
                          Task notifications and queue items.
                        </p>
                      </section>
                      <section className="trygc-shell__panel">
                        <p className="trygc-shell__eyebrow">Mistakes</p>
                        <p className="trygc-shell__metric">{mistakes.length}</p>
                        <p className="trygc-shell__submetric">
                          Logged mistakes currently available from the backend.
                        </p>
                      </section>

                      <section className="trygc-shell__panel trygc-shell__panel--full">
                        <p className="trygc-shell__eyebrow">Recent Updates</p>
                        <div className="trygc-shell__list">
                          {successLogs.slice(0, 4).map((entry, index) => {
                            const record = readRecord(entry) ?? {};
                            const title = readText(
                              record.title ?? record.detail ?? record.time,
                              `Update ${index + 1}`,
                            );
                            const meta = [
                              readText(record.date, ""),
                              readText(record.campaign, ""),
                            ].filter(Boolean);

                            return (
                              <article className="trygc-shell__item" key={index}>
                                <p className="trygc-shell__item-title">{title}</p>
                                {meta.length ? (
                                  <div className="trygc-shell__item-meta">
                                    {meta.map((item, metaIndex) => (
                                      <span
                                        className="trygc-shell__item-pill"
                                        key={`${metaIndex}-${item}`}
                                      >
                                        {item}
                                      </span>
                                    ))}
                                  </div>
                                ) : null}
                              </article>
                            );
                          })}
                          {!successLogs.length ? (
                            <p className="trygc-shell__empty">
                              No success feed entries were returned.
                            </p>
                          ) : null}
                        </div>
                      </section>
                    </div>
                  ) : null}

                  {activeView === "campaigns" ? (
                    <section className="trygc-shell__panel">
                      <p className="trygc-shell__eyebrow">Campaign Lifecycle</p>
                      <div className="trygc-shell__list">
                        {campaigns.slice(0, 8).map((entry, index) => {
                          const record = readRecord(entry) ?? {};
                          const title = readText(record.name, `Campaign ${index + 1}`);
                          const meta = [
                            readText(record.client, "No client"),
                            readText(record.status, "Unknown status"),
                            readText(record.currentPhase, "No phase"),
                            readText(record.market, "No market"),
                          ];

                          return (
                            <article className="trygc-shell__item" key={index}>
                              <p className="trygc-shell__item-title">{title}</p>
                              <div className="trygc-shell__item-meta">
                                {meta.map((item, metaIndex) => (
                                  <span
                                    className="trygc-shell__item-pill"
                                    key={`${metaIndex}-${item}`}
                                  >
                                    {item}
                                  </span>
                                ))}
                              </div>
                              <p className="trygc-shell__item-copy">
                                Budget: {readNumber(record.budget)} | Owner:{" "}
                                {readText(record.owner, "Unassigned")}
                              </p>
                            </article>
                          );
                        })}
                        {!campaigns.length ? (
                          <p className="trygc-shell__empty">
                            No campaigns were returned from the backend.
                          </p>
                        ) : null}
                      </div>
                    </section>
                  ) : null}

                  {activeView === "community-team" ? (
                    <div className="trygc-shell__grid">
                      <section className="trygc-shell__panel">
                        <p className="trygc-shell__eyebrow">Countries</p>
                        <p className="trygc-shell__metric">{countries.length}</p>
                        <p className="trygc-shell__submetric">
                          Country workspaces from `/community-team-data`.
                        </p>
                      </section>
                      <section className="trygc-shell__panel">
                        <p className="trygc-shell__eyebrow">Checklists</p>
                        <p className="trygc-shell__metric">{checklists.length}</p>
                        <p className="trygc-shell__submetric">
                          Team checklists attached to the workspace.
                        </p>
                      </section>

                      <section className="trygc-shell__panel trygc-shell__panel--full">
                        <p className="trygc-shell__eyebrow">Country Boards</p>
                        <div className="trygc-shell__list">
                          {countries.slice(0, 6).map((entry, index) => {
                            const record = readRecord(entry) ?? {};
                            const tasks = asArray(
                              record.tasks as Array<Record<string, unknown>>,
                            );

                            return (
                              <article className="trygc-shell__item" key={index}>
                                <p className="trygc-shell__item-title">
                                  {readText(record.name, `Country ${index + 1}`)}
                                </p>
                                <p className="trygc-shell__item-copy">
                                  {readText(record.summary, "No summary provided")}
                                </p>
                                <div className="trygc-shell__item-meta">
                                  <span className="trygc-shell__item-pill">
                                    Tasks: {tasks.length}
                                  </span>
                                  <span className="trygc-shell__item-pill">
                                    Manager:{" "}
                                    {readText(record.managerName, "Unassigned")}
                                  </span>
                                </div>
                              </article>
                            );
                          })}
                        </div>
                      </section>
                    </div>
                  ) : null}

                  {activeView === "user-management" ? (
                    <section className="trygc-shell__panel">
                      <p className="trygc-shell__eyebrow">Team Members</p>
                      <div className="trygc-shell__list">
                        {teamMembers.slice(0, 10).map((member, index) => (
                          <article className="trygc-shell__item" key={index}>
                            <p className="trygc-shell__item-title">
                              {readText(member.name, member.email ?? "User")}
                            </p>
                            <div className="trygc-shell__item-meta">
                              <span className="trygc-shell__item-pill">
                                {readText(member.role, "member")}
                              </span>
                              <span className="trygc-shell__item-pill">
                                {readText(member.teamName, "No team")}
                              </span>
                            </div>
                            <p className="trygc-shell__item-copy">
                              {member.email || "No email available"}
                            </p>
                          </article>
                        ))}
                        {!teamMembers.length ? (
                          <p className="trygc-shell__empty">
                            No team members were returned from `admin-config`.
                          </p>
                        ) : null}
                      </div>
                    </section>
                  ) : null}

                  {activeView === "settings" ? (
                    <div className="trygc-shell__grid">
                      <section className="trygc-shell__panel">
                        <p className="trygc-shell__eyebrow">Access</p>
                        <p className="trygc-shell__item-title">
                          {getDisplayName(session.user)}
                        </p>
                        <p className="trygc-shell__item-copy">
                          {session.user.email || "No email on session"}
                        </p>
                        <p className="trygc-shell__item-copy">
                          Features: {featureList}
                        </p>
                      </section>
                      <section className="trygc-shell__panel">
                        <p className="trygc-shell__eyebrow">Backend Tools</p>
                        <div className="trygc-session-card__actions">
                          <button
                            className="trygc-session-card__secondary"
                            disabled={activeAction !== null}
                            onClick={handleRefreshSession}
                            type="button"
                          >
                            {activeAction === "refresh" ? <SpinnerIcon /> : null}
                            Refresh Session
                          </button>
                          <button
                            className="trygc-session-card__secondary"
                            disabled={activeAction !== null}
                            onClick={handleLoadWorkspaceConfig}
                            type="button"
                          >
                            {activeAction === "config" ? <SpinnerIcon /> : null}
                            Load Config
                          </button>
                          <button
                            className="trygc-session-card__secondary"
                            disabled={activeAction !== null}
                            onClick={handleExportData}
                            type="button"
                          >
                            {activeAction === "export" ? <SpinnerIcon /> : null}
                            Export Data
                          </button>
                          <button
                            className="trygc-login-form__submit"
                            disabled={activeAction !== null}
                            onClick={handleLogout}
                            type="button"
                          >
                            {activeAction === "logout" ? <SpinnerIcon /> : null}
                            Sign Out
                          </button>
                        </div>
                      </section>

                      {backendPreview ? (
                        <pre className="trygc-session-card__preview trygc-shell__panel--full">
                          {backendPreview}
                        </pre>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                <form className="trygc-login-form" onSubmit={handleSubmit}>
                  {mode === "signup" ? (
                    <label className="trygc-field">
                      <span className="trygc-field__label">Full Name</span>
                      <span className="trygc-field__control">
                        <span className="trygc-field__icon">
                          <UserIcon />
                        </span>
                        <input
                          autoComplete="name"
                          className="trygc-field__input"
                          onChange={(event) => setFullName(event.target.value)}
                          placeholder="Your name"
                          required
                          type="text"
                          value={fullName}
                        />
                      </span>
                    </label>
                  ) : null}

                  <label className="trygc-field">
                    <span className="trygc-field__label">Email</span>
                    <span className="trygc-field__control">
                      <span className="trygc-field__icon">
                        <MailIcon />
                      </span>
                      <input
                        autoComplete="email"
                        className="trygc-field__input"
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="name@company.com"
                        required
                        type="email"
                        value={email}
                      />
                    </span>
                  </label>

                  <label className="trygc-field">
                    <span className="trygc-field__label">Password</span>
                    <span className="trygc-field__control">
                      <span className="trygc-field__icon">
                        <LockIcon />
                      </span>
                      <input
                        autoComplete={
                          mode === "login" ? "current-password" : "new-password"
                        }
                        className="trygc-field__input trygc-field__input--password"
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="••••••••"
                        required
                        type={showPassword ? "text" : "password"}
                        value={password}
                      />
                      <button
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        className="trygc-field__toggle"
                        onClick={() => setShowPassword((current) => !current)}
                        type="button"
                      >
                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                      </button>
                    </span>
                  </label>

                  <button
                    className="trygc-login-form__submit"
                    disabled={isSubmitting}
                    type="submit"
                  >
                    {isSubmitting ? <SpinnerIcon /> : null}
                    {mode === "login"
                      ? isSubmitting
                        ? "Signing In..."
                        : "Sign In"
                      : isSubmitting
                        ? "Creating Account..."
                        : "Create Account"}
                    {!isSubmitting ? <ArrowRightIcon /> : null}
                  </button>
                </form>

                <div className="trygc-login-card__footer">
                  {mode === "login"
                    ? "Don't have an account? "
                    : "Already have an account? "}
                  <button
                    className="trygc-login-card__link"
                    onClick={handleModeSwitch}
                    type="button"
                  >
                    {mode === "login" ? "Sign Up" : "Sign In"}
                  </button>
                </div>
              </>
            )}
          </section>

          <p className="trygc-login-screen__caption">
            Trygc OPS Command · Internal workspace
          </p>
        </div>
      </main>
    </>
  );
}
