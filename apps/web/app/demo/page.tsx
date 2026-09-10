import Dashboard from '../../components/dashboard';

export const dynamic = 'force-dynamic';

export default function DemoPage() {
  // Legacy synthetic clinical decision support demo — preserved verbatim.
  // The .legacy-root wrapper scopes the old style tokens so they don't leak
  // into the new VITALIS design system.
  return (
    <div className="legacy-root">
      <Dashboard />
    </div>
  );
}
