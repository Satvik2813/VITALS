// Disposable PostgreSQL (PGlite) tests: no network, no connection to Supabase.
// npm install --prefix .pytest-security-tools --no-package-lock --ignore-scripts @electric-sql/pglite@0.3.14
// node scripts/test_rls.mjs
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '../.pytest-security-tools/node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
let checks = 0;
try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
      $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  `);
  const migrations = (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  for (const file of migrations) {
    // gen_random_uuid is built into PostgreSQL; PGlite does not ship pgcrypto.
    const sql = (await readFile(`supabase/migrations/${file}`, 'utf8')).replace(
      /CREATE EXTENSION IF NOT EXISTS pgcrypto;/gi,
      '',
    );
    await db.exec(sql);
  }
  // Idempotency check: re-apply the most recently added migration (whichever
  // it currently is). Re-applying an *earlier* one by a fixed name here would
  // be wrong once later migrations add their own grants/policies on the same
  // tables -- the earlier file's unconditional REVOKE ALL would wipe them out
  // as an artifact of this test's replay, not a real deployment scenario.
  const final = migrations[migrations.length - 1];
  await db.exec(await readFile(`supabase/migrations/${final}`, 'utf8')); // idempotency
  const a = '10000000-0000-0000-0000-000000000001';
  const b = '10000000-0000-0000-0000-000000000002';
  const c = '10000000-0000-0000-0000-000000000003';
  const d = '10000000-0000-0000-0000-000000000004'; // self-registered patient identity
  const e = '10000000-0000-0000-0000-000000000005'; // a second, unrelated patient identity
  const p = '20000000-0000-0000-0000-000000000001';
  const other = '20000000-0000-0000-0000-000000000002';
  const selfPatient = '20000000-0000-0000-0000-000000000003'; // owner=a (assigned doctor), user_id=d
  await db.exec(`
    INSERT INTO auth.users VALUES ('${a}','doctor-a@example.invalid','{}'),
      ('${b}','doctor-b@example.invalid','{}'), ('${c}','doctor-c@example.invalid','{}'),
      ('${d}','patient-d@example.invalid','{}'), ('${e}','patient-e@example.invalid','{}');
    -- The auth.users trigger already created blank app_profiles rows for
    -- d/e; finish "onboarding" them as patients.
    UPDATE app_profiles SET role='patient', onboarding_completed=true WHERE id IN ('${d}','${e}');
    INSERT INTO app_patients(id,owner_id,full_name) VALUES
      ('${p}','${a}','Synthetic A'), ('${other}','${b}','Synthetic B');
    INSERT INTO app_patients(id,owner_id,user_id,full_name) VALUES
      ('${selfPatient}','${a}','${d}','Self-Registered Patient');
    INSERT INTO app_doctor_patients(doctor_id,patient_id,granted_by) VALUES ('${c}','${p}','${a}');
    INSERT INTO app_vitals(patient_id,recorded_at) VALUES ('${p}',now()),('${other}',now()),('${selfPatient}',now());
    INSERT INTO app_alerts(patient_id,severity,kind,message) VALUES
      ('${p}','info','DEMO','Synthetic'),('${other}','info','DEMO','Synthetic'),
      ('${selfPatient}','info','DEMO','Synthetic');
    INSERT INTO app_risk_assessments(patient_id,model_version,score,state) VALUES
      ('${p}','test',0,'NORMAL'),('${other}','test',0,'NORMAL'),('${selfPatient}','test',0,'NORMAL');
    INSERT INTO app_documents(patient_id,filename,storage_path,sha256,size_bytes) VALUES
      ('${p}','demo.txt','fixture','abc',1),('${other}','demo.txt','fixture','abc',1),
      ('${selfPatient}','demo.txt','fixture','abc',1);
    INSERT INTO app_audit_events(actor_id,patient_id,event_type) VALUES
      ('${a}','${p}','TEST'),('${b}','${other}','TEST');
    -- Bridge pairing state for the self-registered patient. Digests here are
    -- placeholders; RLS does not care what they contain, only who can read them.
    INSERT INTO app_patient_bridge_codes(patient_id,code,code_hash) VALUES
      ('${selfPatient}','VTL-8F4K-29QX','sha256-of-the-code');
    INSERT INTO app_bridge_devices(patient_id,device_id,device_name,token_hash) VALUES
      ('${selfPatient}','handset-1','Synthetic Pixel','sha256-of-the-token');
  `);
  const scalar = async (sql) => Object.values((await db.query(sql)).rows[0])[0];
  const eq = async (sql, expected) => {
    assert.equal(await scalar(sql), expected, sql);
    checks++;
  };
  const denied = async (sql) => {
    await assert.rejects(db.exec(sql), (e) => e.code === '42501');
    checks++;
  };
  const user = async (id, anonymous = false) => {
    await db.exec(`RESET ROLE; SET request.jwt.claim.sub='${id}';
      SET request.jwt.claims='{"is_anonymous":${anonymous}}'; SET ROLE authenticated;`);
  };
  const medical = [
    'app_patients',
    'app_vitals',
    'app_alerts',
    'app_risk_assessments',
    'app_documents',
    'app_audit_events',
  ];
  const clinical = ['app_patients', 'app_vitals', 'app_alerts', 'app_risk_assessments', 'app_documents'];
  // Doctor `a` now owns two patients (p, and the self-registered selfPatient),
  // so their visible clinical-row counts are 2; b and c still see exactly 1.
  const expectedClinical = { [a]: 2, [b]: 1, [c]: 1 };
  for (const id of [a, b, c]) {
    await user(id);
    for (const table of clinical) await eq(`SELECT count(*)::int FROM ${table}`, expectedClinical[id]);
    await eq(`SELECT count(*)::int FROM app_audit_events WHERE event_type='TEST'`, 1);
    await eq(`SELECT count(*)::int FROM app_patients WHERE id='${id === b ? p : other}'`, 0);
    await denied(`UPDATE app_profiles SET role='admin' WHERE id='${id}'`);
    await denied(`INSERT INTO app_audit_events(event_type) VALUES ('FORGED')`);
    for (const table of medical) await denied(`TRUNCATE ${table} CASCADE`);
  }

  // --- Patient self-access (new: patient/doctor role architecture) ---------
  await user(d);
  for (const table of clinical) {
    const own = table === 'app_patients' ? `id='${selfPatient}'` : `patient_id='${selfPatient}'`;
    await eq(`SELECT count(*)::int FROM ${table} WHERE ${own}`, 1);
  }
  // The patient must not see any other patient's row or clinical data.
  for (const otherId of [p, other]) {
    for (const table of clinical) {
      const col = table === 'app_patients' ? 'id' : 'patient_id';
      await eq(`SELECT count(*)::int FROM ${table} WHERE ${col}='${otherId}'`, 0);
    }
  }
  // Self-editable contact field: allowed.
  await db.exec(`UPDATE app_patients SET phone='+10000000000' WHERE id='${selfPatient}'`);
  checks++;
  // Identity/clinical field: the row-level policy would allow it (same row),
  // but the column grant must still deny it -- defense in depth.
  await denied(`UPDATE app_patients SET full_name='Hijacked' WHERE id='${selfPatient}'`);
  // Cannot self-promote, cannot write clinical data directly, cannot forge audit.
  await denied(`UPDATE app_profiles SET role='admin' WHERE id='${d}'`);
  await denied(`INSERT INTO app_vitals(patient_id,recorded_at) VALUES ('${selfPatient}',now())`);
  await denied(`INSERT INTO app_audit_events(event_type) VALUES ('FORGED')`);
  for (const table of medical) await denied(`TRUNCATE ${table} CASCADE`);

  // --- Bridge pairing: readable by the patient, by nobody else ------------
  // The bridge code is a device-enrolment credential for one patient. Unlike
  // every other patient-scoped table, the owning doctor must NOT be able to
  // read it -- otherwise they could pair a handset as their own patient.
  const bridge = ['app_patient_bridge_codes', 'app_bridge_devices'];
  await user(d);
  for (const table of bridge) {
    await eq(`SELECT count(*)::int FROM ${table} WHERE patient_id='${selfPatient}'`, 1);
    // Writes are backend-only, exactly like vitals/risk/document provenance.
    await denied(`UPDATE ${table} SET patient_id='${selfPatient}'`);
    await denied(`DELETE FROM ${table}`);
    await denied(`TRUNCATE ${table} CASCADE`);
  }
  await denied(`INSERT INTO app_bridge_devices(patient_id,device_id,token_hash)
    VALUES ('${selfPatient}','forged','forged-hash')`);
  await denied(`INSERT INTO app_patient_bridge_codes(patient_id,code,code_hash)
    VALUES ('${p}','VTL-0000-0000','forged-hash')`);
  // Even the owner cannot read the digests: those columns carry no SELECT grant.
  await denied(`SELECT code_hash FROM app_patient_bridge_codes`);
  await denied(`SELECT token_hash FROM app_bridge_devices`);
  // The assigned doctor (owner of this patient's record) sees no pairing state.
  await user(a);
  for (const table of bridge) await eq(`SELECT count(*)::int FROM ${table}`, 0);
  // Neither does an unrelated patient, or a doctor sharing the other patient.
  for (const id of [b, c, e]) {
    await user(id);
    for (const table of bridge) await eq(`SELECT count(*)::int FROM ${table}`, 0);
  }
  // Anonymous sign-ins carry the `authenticated` role; the restrictive policy
  // must still exclude them.
  await user(d, true);
  for (const table of bridge) await eq(`SELECT count(*)::int FROM ${table}`, 0);
  await user(e);

  // A second, unrelated patient identity sees none of the above patient's data.
  await user(e);
  for (const table of clinical) {
    const col = table === 'app_patients' ? 'id' : 'patient_id';
    await eq(`SELECT count(*)::int FROM ${table} WHERE ${col}='${selfPatient}'`, 0);
  }
  // RLS filters the row out of the UPDATE's target set entirely (not a grant
  // failure), so this affects zero rows rather than throwing.
  await eq(
    `WITH changed AS (UPDATE app_patients SET phone='+1hijack'
    WHERE id='${selfPatient}' RETURNING *) SELECT count(*)::int FROM changed`,
    0,
  );
  await user(c);
  await eq(
    `WITH changed AS (UPDATE app_patients SET full_name='Forbidden' WHERE id='${p}' RETURNING *) SELECT count(*)::int FROM changed`,
    0,
  );
  await denied(`INSERT INTO app_doctor_patients(doctor_id,patient_id) VALUES ('${c}','${other}')`);
  await user(a);
  await db.exec(`UPDATE app_profiles SET full_name='Synthetic Doctor A' WHERE id='${a}'`);
  checks++;
  for (const table of [
    'app_vitals',
    'app_alerts',
    'app_risk_assessments',
    'app_documents',
    'app_audit_events',
  ]) {
    await denied(`DELETE FROM ${table}`);
  }
  await user(a, true);
  for (const table of medical) await eq(`SELECT count(*)::int FROM ${table}`, 0);
  await denied(`INSERT INTO app_patients(owner_id,full_name) VALUES ('${a}','Anonymous')`);
  await db.exec('RESET ROLE; SET ROLE anon;');
  const allTables = (await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'`)).rows;
  for (const { tablename } of allTables) await denied(`SELECT * FROM public.${tablename}`);
  await denied(`SELECT public.app_has_patient_access('${p}')`);
  await db.exec('RESET ROLE; SET ROLE service_role;');
  // service_role bypasses RLS and sees every row: 3 clinical rows now that a
  // third (self-registered) patient exists, audit still 2 TEST-tagged rows.
  for (const table of medical)
    await eq(
      `SELECT count(*)::int FROM ${table}${table === 'app_audit_events' ? " WHERE event_type='TEST'" : ''}`,
      table === 'app_audit_events' ? 2 : 3,
    );
  await db.exec('RESET ROLE;');
  await eq(`SELECT count(*)::int FROM app_audit_events WHERE event_type='PATIENT_ACCESS_GRANTED'`, 1);
  await user(a);
  await db.exec(`DELETE FROM app_doctor_patients WHERE patient_id='${p}' AND doctor_id='${c}'`);
  await eq(
    `SELECT count(*)::int FROM app_audit_events WHERE event_type='PATIENT_ACCESS_REVOKED' AND actor_id='${a}'`,
    1,
  );
  await user(c);
  await eq(`SELECT count(*)::int FROM app_patients`, 0);
  await db.exec(`RESET ROLE; UPDATE app_profiles SET role='admin' WHERE id='${b}'`);
  // 2 of these are from onboarding d/e as patients in the fixture setup above;
  // this UPDATE contributes the 3rd.
  await eq(`SELECT count(*)::int FROM app_audit_events WHERE event_type='USER_ROLE_CHANGED'`, 3);
  // Force an audit constraint failure: the accompanying access grant must roll back.
  await db.exec(`ALTER TABLE app_audit_events ADD CONSTRAINT test_reject_audit
    CHECK (event_type <> 'PATIENT_ACCESS_GRANTED') NOT VALID`);
  await user(a);
  await assert.rejects(
    db.exec(`INSERT INTO app_doctor_patients(doctor_id,patient_id,granted_by)
    VALUES ('${c}','${p}','${a}')`),
    (e) => e.code === '23514',
  );
  checks++;
  await eq(`SELECT count(*)::int FROM app_doctor_patients WHERE doctor_id='${c}'`, 0);
  await db.exec('RESET ROLE; ALTER TABLE app_audit_events DROP CONSTRAINT test_reject_audit;');
  await eq(`SELECT count(*)::int FROM pg_tables WHERE schemaname='public' AND NOT rowsecurity`, 0);

  // -------------------------------------------------------------------------
  // Schema-domain checks.
  //
  // The SQLite mirror in apps/api/app/db_platform.py carries no CHECK
  // constraints, so the Python suite cannot see a mismatch between a
  // PostgreSQL enumerated domain and the literals the application actually
  // writes. Two production-fatal bugs hid in exactly that gap: the document
  // gateway emits 'TRUSTED' (rejected by the original scan_verdict CHECK, so
  // every CLEAN upload 500'd while malicious ones succeeded), and the trained
  // model emitted its own five-class vocabulary into a four-value state CHECK.
  //
  // These assertions therefore exercise the REAL literals from the
  // application, against real PostgreSQL. Keep them in sync with
  // app/gateway.py `analyze`, app/ml.py CANONICAL_STATES and
  // app/api_v1/router.py ALERT_SEVERITY_RANK.
  // -------------------------------------------------------------------------
  await db.exec('RESET ROLE;');
  const accepts = async (sql, label) => {
    try {
      await db.exec(sql);
    } catch (e) {
      assert.fail(`${label} was rejected by PostgreSQL: ${e.message}`);
    }
    checks++;
  };

  // app_documents.scan_verdict must accept every verdict app/gateway.py emits.
  for (const verdict of ['TRUSTED', 'SUSPICIOUS', 'MALICIOUS']) {
    await accepts(
      `INSERT INTO app_documents(patient_id,filename,storage_path,sha256,size_bytes,scan_verdict)
      VALUES ('${p}','v-${verdict}.pdf','/tmp/v','abc',1,'${verdict}')`,
      `scan_verdict '${verdict}'`,
    );
  }
  // ...and the values already in use elsewhere (the seed writes PENDING).
  for (const verdict of ['CLEAN', 'PENDING']) {
    await accepts(
      `INSERT INTO app_documents(patient_id,filename,storage_path,sha256,size_bytes,scan_verdict)
      VALUES ('${p}','v-${verdict}.pdf','/tmp/v','abc',1,'${verdict}')`,
      `scan_verdict '${verdict}'`,
    );
  }
  await assert.rejects(
    db.exec(`INSERT INTO app_documents(patient_id,filename,storage_path,sha256,size_bytes,scan_verdict)
    VALUES ('${p}','bogus.pdf','/tmp/v','abc',1,'NOT_A_VERDICT')`),
    (e) => e.code === '23514',
  );
  checks++;

  // app_risk_assessments.state must accept exactly the canonical states, and
  // must reject the trained model's raw class labels -- which is what makes
  // the mapping in app/ml.py `canonical_state` load-bearing rather than
  // cosmetic.
  for (const state of ['NORMAL', 'WATCH', 'WARNING', 'CRITICAL']) {
    await accepts(
      `INSERT INTO app_risk_assessments(patient_id,model_version,score,state)
      VALUES ('${p}','schema-check',1,'${state}')`,
      `risk state '${state}'`,
    );
  }
  for (const raw of ['Stable', 'Watch', 'Moderate', 'High', 'Critical']) {
    await assert.rejects(
      db.exec(`INSERT INTO app_risk_assessments(patient_id,model_version,score,state)
      VALUES ('${p}','schema-check',1,'${raw}')`),
      (e) => e.code === '23514',
      `raw model label '${raw}' must not be storable`,
    );
    checks++;
  }

  // app_alerts.severity must accept every severity the alerting rule writes.
  for (const severity of ['info', 'watch', 'warning', 'critical']) {
    await accepts(
      `INSERT INTO app_alerts(patient_id,severity,kind,message)
      VALUES ('${p}','${severity}','SCHEMA_CHECK','synthetic')`,
      `severity '${severity}'`,
    );
  }

  // Vitals idempotency: a device replaying the same reading must collide.
  const moment = '2026-09-10T12:00:00Z';
  await accepts(
    `INSERT INTO app_vitals(patient_id,recorded_at,heart_rate,device_id)
    VALUES ('${p}','${moment}',78,'handset-1')`,
    'first device reading',
  );
  await assert.rejects(
    db.exec(`INSERT INTO app_vitals(patient_id,recorded_at,heart_rate,device_id)
    VALUES ('${p}','${moment}',78,'handset-1')`),
    (e) => e.code === '23505',
    'a replayed device reading must be rejected',
  );
  checks++;
  // A different handset at the same instant is a genuinely different reading.
  await accepts(
    `INSERT INTO app_vitals(patient_id,recorded_at,heart_rate,device_id)
    VALUES ('${p}','${moment}',78,'handset-2')`,
    'second handset, same instant',
  );
  // Manual clinician entries carry no device_id and must stay unconstrained
  // (SQL NULLs are distinct), so historical rows never become invalid.
  await accepts(
    `INSERT INTO app_vitals(patient_id,recorded_at,heart_rate) VALUES ('${p}','${moment}',80)`,
    'first manual reading',
  );
  await accepts(
    `INSERT INTO app_vitals(patient_id,recorded_at,heart_rate) VALUES ('${p}','${moment}',81)`,
    'second manual reading at the same instant',
  );

  console.log(
    `${checks} PostgreSQL RLS/grant/schema checks passed; all migrations applied; final migration reapplied safely.`,
  );
} finally {
  await db.close();
}
