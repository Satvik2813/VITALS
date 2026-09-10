'use client';
import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Smartphone } from 'lucide-react';
import { api, ApiError, type BridgeCode } from '../../lib/api-v1';

/**
 * The patient's permanent VITALIS Bridge Code.
 *
 * Deliberately a small, self-contained card that drops into the existing
 * patient surfaces (Profile, Device) without disturbing anything around it:
 * it fetches its own data, renders nothing at all when the signed-in user has
 * no patient record of their own (a doctor, for instance), and stays quiet on
 * failure rather than throwing an error banner into an unrelated page.
 */
export function BridgeCodeCard({
  code: provided,
}: {
  /** Already-fetched data, to skip the request (the Device page supplies it). */
  code?: BridgeCode | null;
}) {
  const [fetched, setFetched] = useState<BridgeCode | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>(provided ? 'ready' : 'loading');
  const [copied, setCopied] = useState(false);
  const data = provided ?? fetched;

  useEffect(() => {
    if (provided) {
      setState('ready');
      return;
    }
    let alive = true;
    (async () => {
      try {
        const result = await api.bridge.code();
        if (!alive) return;
        setFetched(result);
        setState('ready');
      } catch (e) {
        if (!alive) return;
        // 404 simply means "this account is not a patient" — not a failure
        // worth showing anyone.
        setState('unavailable');
        if (!(e instanceof ApiError)) console.error(e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [provided]);

  const copy = useCallback(async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.bridge_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be denied (insecure origin, permission policy).
      // The code is on screen and typeable, so this is not worth surfacing.
    }
  }, [data]);

  if (state !== 'ready' || !data) return null;

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Smartphone size={14} style={{ color: 'var(--v-brand-2)', flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>VITALIS Bridge Code</span>
      </div>

      <div className="v-bridge-row">
        <code className="v-bridge-code">{data.bridge_code}</code>
        <button
          type="button"
          onClick={copy}
          className="v-btn v-btn-secondary"
          aria-label={copied ? 'Bridge code copied' : 'Copy bridge code'}
          style={{ flexShrink: 0, minHeight: 40 }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <p className="v-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.6 }}>
        Enter this code in the VITALIS Bridge app on your phone to link it to your account. The code does not
        expire — keep it private.
      </p>

      <style jsx>{`
        .v-bridge-row {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .v-bridge-code {
          flex: 1 1 auto;
          min-width: 0;
          padding: 10px 14px;
          border-radius: var(--v-radius-sm);
          background: var(--v-surface-2);
          border: 1px solid var(--v-border);
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 17px;
          font-weight: 600;
          letter-spacing: 0.08em;
          color: var(--v-text);
          user-select: all;
          overflow-wrap: anywhere;
        }
        @media (max-width: 380px) {
          .v-bridge-code {
            font-size: 15px;
            letter-spacing: 0.04em;
          }
        }
      `}</style>
    </div>
  );
}
