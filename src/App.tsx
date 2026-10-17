import { useEffect, useState } from 'react';

export default function App() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.vrs?.app.getVersion().then((v) => {
      if (!cancelled) setVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex h-screen flex-col bg-surface text-content">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
        <h1 className="text-sm font-semibold tracking-tight">Vangard Research Studio</h1>
        {version && <span className="text-xs text-content-muted">v{version}</span>}
      </header>
      <main className="flex flex-1 items-center justify-center">
        <p className="text-sm text-content-muted">Create or open a research project to get started.</p>
      </main>
    </div>
  );
}
