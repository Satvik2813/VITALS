'use client';
import { useCallback, useEffect, useState } from 'react';
import { Bluetooth, RefreshCw, Smartphone, Unlink } from 'lucide-react';
import { api, ApiError, type BridgeCode } from '../../../../lib/api-v1';
import { BridgeCodeCard } from '../../../../components/vitalis/bridge-code';
import { ErrorBanner, Loading } from '../../../../components/vitalis/ui';

export default function PatientDevicePage() {
  const [data, setData] = useState<BridgeCode | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api.bridge.code());
      setStatus('ready');
    } catch (e) {
      setStatus('unavailable');
      if (e instanceof ApiError && e.status !== 404) setError(e.message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function disconnect(deviceId: string) {
    setBusy(deviceId);
    setError('');
    try {
      await api.bridge.revokeDevice(deviceId);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy('');
    }
  }

  async function regenerate() {
    if (
      !confirm(
        'Generate a new Bridge Code? The old code will stop working. Phones already connected stay connected.',
      )
    )
      return;
    setBusy('regenerate');
    setError('');
    try {
      setData(await api.bridge.regenerate());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy('');
    }
  }

  const devices = data?.devices ?? [];

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <span className="v-eyebrow">Wearable</span>
        <h1 className="v-h2" style={{ marginTop: 6, fontSize: 22 }}>
          Device
        </h1>
        <p className="v-muted" style={{ marginTop: 6, fontSize: 13 }}>
          Link the VITALIS Bridge app on your phone to stream vitals automatically.
        </p>
      </div>

      {error && <ErrorBanner message={error} />}
      {status === 'loading' && <Loading label="Loading your device" />}

      {status === 'ready' && (
        <>
          <section className="v-card-lg" style={{ padding: 20 }}>
            <BridgeCodeCard code={data} />
            <ol
              className="v-muted"
              style={{ margin: '16px 0 0', paddingLeft: 20, fontSize: 12, lineHeight: 1.9 }}
            >
              <li>Open VITALIS Bridge on your Android phone.</li>
              <li>Enter the code above.</li>
              <li>Your readings appear in Vitals and History automatically.</li>
            </ol>
            <button
              onClick={regenerate}
              disabled={busy === 'regenerate'}
              className="v-btn v-btn-ghost"
              style={{ marginTop: 14, fontSize: 12 }}
            >
              <RefreshCw size={13} />
              {busy === 'regenerate' ? 'Generating…' : 'Generate a new code'}
            </button>
          </section>

          <section className="v-card-lg" style={{ padding: 20, marginTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Connected devices</div>
            {devices.length === 0 ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: 14,
                  borderRadius: 'var(--v-radius-sm)',
                  background: 'var(--v-surface-2)',
                  border: '1px solid var(--v-border)',
                }}
              >
                <Bluetooth size={18} style={{ color: 'var(--v-text-muted)', flexShrink: 0 }} />
                <div style={{ fontSize: 12, color: 'var(--v-text-muted)' }}>
                  No phone connected yet. Enter your Bridge Code above to link one.
                </div>
              </div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
                {devices.map((d) => (
                  <li
                    key={d.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: 14,
                      borderRadius: 'var(--v-radius-sm)',
                      background: 'var(--v-surface-2)',
                      border: '1px solid var(--v-border)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <Smartphone size={18} style={{ color: 'var(--v-brand-2)', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 120 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{d.device_name || 'Android phone'}</div>
                      <div style={{ fontSize: 11, color: 'var(--v-text-muted)' }}>
                        {d.last_seen_at
                          ? `Last synced ${new Date(d.last_seen_at).toLocaleString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}`
                          : 'Waiting for the first reading'}
                      </div>
                    </div>
                    <button
                      onClick={() => disconnect(d.id)}
                      disabled={busy === d.id}
                      className="v-btn v-btn-ghost"
                      style={{ fontSize: 12 }}
                    >
                      <Unlink size={13} />
                      {busy === d.id ? 'Disconnecting…' : 'Disconnect'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {status === 'unavailable' && !error && (
        <section className="v-card-lg" style={{ padding: 24, textAlign: 'center' }}>
          <div
            aria-hidden="true"
            style={{
              width: 64,
              height: 64,
              margin: '0 auto',
              borderRadius: 999,
              background: 'var(--v-surface-2)',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--v-text-muted)',
            }}
          >
            <Bluetooth size={28} />
          </div>
          <h2 style={{ marginTop: 16, fontSize: 16, fontWeight: 600 }}>No health profile yet</h2>
          <p className="v-muted" style={{ marginTop: 6, fontSize: 13, maxWidth: 320, marginInline: 'auto' }}>
            Finish onboarding to get your Bridge Code and connect a device.
          </p>
        </section>
      )}
    </div>
  );
}
