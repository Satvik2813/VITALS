/**
 * Real, authenticated Supabase test sessions for Playwright.
 *
 * Patient and doctor are now separate authenticated roles with their own
 * onboarding (not a UI "view mode"), so a realistic test needs two distinct
 * identities: a doctor and a patient who has actually onboarded and picked
 * that doctor. There is no interactive-OAuth automation path (Google
 * requires a human) and no existing frontend-side mock-auth mechanism, so
 * this creates REAL, disposable Supabase Auth users via the Admin API,
 * exchanges a magic-link token for a REAL session (a genuine, validly signed
 * JWT subject to the exact same RLS policies as a live Google login), and
 * injects it as a cookie in the exact format @supabase/ssr expects (verified
 * against the installed package's source: cookie name
 * `sb-<project-ref>-auth-token`, value `base64-` + base64url(JSON of the
 * session), see node_modules/@supabase/ssr/dist/main/{cookies,createServerClient}.js).
 *
 * Everything created here is deleted in cleanup(). Nothing here touches the
 * real, existing hosted user or weakens any production check -- these are
 * normal authenticated users going through the normal onboarding endpoints
 * and RLS-scoped API calls, just without a human clicking through Google's
 * consent screen.
 */
import { createClient } from '@supabase/supabase-js';
import type { APIRequestContext } from '@playwright/test';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const authFixtureAvailable = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);

function projectRef(url: string): string {
  return new URL(url).hostname.split('.')[0];
}

export type TestIdentity = {
  userId: string;
  cookie: { name: string; value: string; domain: string; path: string };
};

/**
 * A bare, real, disposable identity that has NOT called either onboarding
 * endpoint -- for exercising "brand-new signup" routing (should land on
 * /get-started, never a dashboard).
 */
export async function createBareTestIdentity(): Promise<TestIdentity & { cleanup: () => Promise<void> }> {
  if (!authFixtureAvailable) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_* not set -- cannot create an E2E session');
  }
  const email = `vitalis-e2e-bare-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`;
  const identity = await createTestIdentity(email);
  return { ...identity, cleanup: () => deleteIdentity(identity) };
}

/** Creates a disposable, real Supabase Auth user and a real session for it. */
async function createTestIdentity(email: string): Promise<TestIdentity> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anon = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: 'E2E Test User' },
  });
  if (createErr || !created?.user) {
    throw new Error(`Failed to create E2E test user (${email}): ${createErr?.message}`);
  }
  const userId = created.user.id;

  try {
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    const tokenHash = linkData?.properties?.hashed_token;
    if (linkErr || !tokenHash) {
      throw new Error(`Failed to generate E2E session link: ${linkErr?.message}`);
    }

    const { data: verified, error: verifyErr } = await anon.auth.verifyOtp({
      type: 'magiclink',
      token_hash: tokenHash,
    });
    if (verifyErr || !verified?.session) {
      throw new Error(`Failed to verify E2E session: ${verifyErr?.message}`);
    }
    const session = verified.session;

    const cookieName = `sb-${projectRef(SUPABASE_URL)}-auth-token`;
    const cookieValue = 'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
    return { userId, cookie: { name: cookieName, value: cookieValue, domain: '127.0.0.1', path: '/' } };
  } catch (e) {
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw e;
  }
}

function authHeader(identity: TestIdentity) {
  return { Cookie: `${identity.cookie.name}=${identity.cookie.value}` };
}

export type DoctorTestSession = TestIdentity & { patientId: string };

/**
 * A real doctor identity that has completed /api/v1/onboarding/doctor, with
 * one synthetic patient (created via the pre-existing doctor-create-patient
 * endpoint) carrying a normal-range and a clearly-abnormal vitals reading.
 */
export async function createTestDoctorSession(apiRequest: APIRequestContext): Promise<DoctorTestSession> {
  if (!authFixtureAvailable) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_* not set -- cannot create an E2E session');
  }
  const email = `vitalis-e2e-doctor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`;
  const identity = await createTestIdentity(email);
  const headers = authHeader(identity);

  const onboard = await apiRequest.post('/api/v1/onboarding/doctor', {
    headers,
    data: { full_name: 'E2E Test Doctor', specialization: 'Internal Medicine', hospital: 'E2E General' },
  });
  if (!onboard.ok()) {
    throw new Error(`Failed to onboard E2E doctor: ${onboard.status()} ${await onboard.text()}`);
  }

  const patientRes = await apiRequest.post('/api/v1/patients', {
    headers,
    data: { full_name: 'E2E Synthetic Patient', mrn: `E2E-${Date.now()}`, sex: 'female' },
  });
  if (!patientRes.ok()) {
    throw new Error(`Failed to seed E2E patient: ${patientRes.status()} ${await patientRes.text()}`);
  }
  const patient = await patientRes.json();
  const patientId = patient.id as string;

  const now = new Date();
  await apiRequest.post(`/api/v1/patients/${patientId}/vitals`, {
    headers,
    data: {
      recorded_at: new Date(now.getTime() - 5 * 60_000).toISOString(),
      heart_rate: 78, spo2: 98, respiratory_rate: 16, temperature_c: 36.8,
      systolic_bp: 118, diastolic_bp: 76, consciousness: 'A', supplemental_oxygen: false,
      source: 'e2e-fixture',
    },
  });
  // Clearly abnormal reading so the risk/alert pipeline has something to
  // react to. Tests must not assume a specific state/severity comes back
  // (the trained model's exact thresholds aren't something a UI test should
  // depend on) -- only that the pages render either way.
  await apiRequest.post(`/api/v1/patients/${patientId}/vitals`, {
    headers,
    data: {
      recorded_at: now.toISOString(),
      heart_rate: 178, spo2: 84, respiratory_rate: 32, temperature_c: 39.4,
      systolic_bp: 84, diastolic_bp: 52, consciousness: 'V', supplemental_oxygen: true,
      source: 'e2e-fixture',
    },
  });

  return { ...identity, patientId };
}

export type PatientTestSession = TestIdentity & { patientId: string; assignedDoctorId: string };

/**
 * A real patient identity that has completed /api/v1/onboarding/patient,
 * assigned to the given doctor. If no doctor is provided, one is created
 * first. Returns both sessions so tests can exercise the real relationship
 * (assigned doctor sees the patient; other doctors/patients do not).
 */
export async function createTestPatientSession(
  apiRequest: APIRequestContext,
  doctor?: DoctorTestSession,
): Promise<{ doctor: DoctorTestSession; patient: PatientTestSession }> {
  if (!authFixtureAvailable) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_* not set -- cannot create an E2E session');
  }
  const doctorSession = doctor || (await createTestDoctorSession(apiRequest));

  const email = `vitalis-e2e-patient-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`;
  const identity = await createTestIdentity(email);
  const headers = authHeader(identity);

  const onboard = await apiRequest.post('/api/v1/onboarding/patient', {
    headers,
    data: {
      full_name: 'E2E Test Patient',
      date_of_birth: '1992-06-15',
      sex: 'female',
      phone: '+15550100000',
      emergency_contact_name: 'E2E Emergency Contact',
      emergency_contact_phone: '+15550100001',
      assigned_doctor_id: doctorSession.userId,
      consent_accepted: true,
    },
  });
  if (!onboard.ok()) {
    throw new Error(`Failed to onboard E2E patient: ${onboard.status()} ${await onboard.text()}`);
  }
  const patient = await onboard.json();
  const patientId = patient.id as string;

  const now = new Date();
  const doctorHeaders = authHeader(doctorSession);
  await apiRequest.post(`/api/v1/patients/${patientId}/vitals`, {
    headers: doctorHeaders,
    data: {
      recorded_at: new Date(now.getTime() - 5 * 60_000).toISOString(),
      heart_rate: 76, spo2: 97, respiratory_rate: 15, temperature_c: 36.7,
      systolic_bp: 116, diastolic_bp: 74, consciousness: 'A', supplemental_oxygen: false,
      source: 'e2e-fixture',
    },
  });
  await apiRequest.post(`/api/v1/patients/${patientId}/vitals`, {
    headers: doctorHeaders,
    data: {
      recorded_at: now.toISOString(),
      heart_rate: 172, spo2: 85, respiratory_rate: 30, temperature_c: 39.2,
      systolic_bp: 88, diastolic_bp: 55, consciousness: 'V', supplemental_oxygen: true,
      source: 'e2e-fixture',
    },
  });

  return {
    doctor: doctorSession,
    patient: { ...identity, patientId, assignedDoctorId: doctorSession.userId },
  };
}

async function deleteIdentity(identity: TestIdentity): Promise<void> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await admin.auth.admin.deleteUser(identity.userId).catch(() => {});
}

export async function cleanupDoctorSession(apiRequest: APIRequestContext, session: DoctorTestSession): Promise<void> {
  await apiRequest.delete(`/api/v1/patients/${session.patientId}`, { headers: authHeader(session) }).catch(() => {});
  await deleteIdentity(session);
}

export async function cleanupPatientPair(
  apiRequest: APIRequestContext,
  pair: { doctor: DoctorTestSession; patient: PatientTestSession },
): Promise<void> {
  // Patient row's owner_id references the doctor profile (ON DELETE RESTRICT),
  // so it must go before the doctor's profile is deleted.
  await apiRequest
    .delete(`/api/v1/patients/${pair.patient.patientId}`, { headers: authHeader(pair.doctor) })
    .catch(() => {});
  await deleteIdentity(pair.patient);
  await cleanupDoctorSession(apiRequest, pair.doctor);
}
