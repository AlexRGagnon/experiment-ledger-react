import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { FormEvent } from 'react';
import { parseRun } from '../shared/contracts.js';
import type { Run, RunInput } from '../shared/contracts.js';
import './style.css';

const baseline: RunInput = {
  name: 'Baseline / synthetic',
  model: 'ridge-v1',
  dataset: 'synthetic-holdout',
  seed: 17,
  metrics: { accuracy: 0.72, latency_ms: 140 },
};
const candidate: RunInput = {
  name: 'Candidate / synthetic',
  model: 'ridge-v2',
  dataset: 'synthetic-holdout',
  seed: 17,
  metrics: { accuracy: 0.79, latency_ms: 128 },
};
class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', 'X-Ledger-Client': '1', ...options.headers },
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new ApiError(data.error ?? 'Request failed.', response.status);
  return data;
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Request failed.';
}
function numeric(value: number | undefined) {
  return value === undefined ? 'Not reported' : Number(value.toPrecision(7)).toString();
}
function App() {
  const [runs, setRuns] = useState<Run[]>([]),
    [query, setQuery] = useState(''),
    [revision, setRevision] = useState(0);
  const [input, setInput] = useState(''),
    [selected, setSelected] = useState<Run[]>([]),
    [current, setCurrent] = useState<Run | null>(null);
  const [notes, setNotes] = useState(''),
    [message, setMessage] = useState('All data stays on this computer.'),
    [error, setError] = useState('');
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [truncated, setTruncated] = useState(false),
    [conflict, setConflict] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void api<{ runs: Run[]; truncated: boolean }>('/api/runs?q=' + encodeURIComponent(query), {
      signal: controller.signal,
    })
      .then((data) => {
        setRuns(data.runs);
        setTruncated(data.truncated);
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(errorText(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, revision]);
  function inspect(run: Run) {
    setCurrent(run);
    setNotes(run.notes);
    setConflict(false);
    setError('');
  }
  async function importRun(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      let value: unknown;
      try {
        value = JSON.parse(input) as unknown;
      } catch {
        throw new Error('Invalid JSON. Check the input and try again.');
      }
      const parsed = parseRun(value);
      const result = await api<{ run: Run; created: boolean }>('/api/runs', {
        method: 'POST',
        body: JSON.stringify(parsed),
      });
      inspect(result.run);
      setRevision((x) => x + 1);
      setMessage((result.created ? 'Imported: ' : 'Already stored: ') + result.run.name);
    } catch (e: unknown) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function toggle(run: Run) {
    setSelected((values) =>
      values.some((x) => x.id === run.id)
        ? values.filter((x) => x.id !== run.id)
        : values.length < 2
          ? [...values, run]
          : values,
    );
  }
  async function saveNotes(event: FormEvent) {
    event.preventDefault();
    if (!current) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ run: Run }>('/api/runs/' + current.id, {
        method: 'PATCH',
        body: JSON.stringify({ notes, version: current.version }),
      });
      setCurrent(result.run);
      setConflict(false);
      setMessage('Notes saved. Version ' + result.run.version);
      setRevision((x) => x + 1);
    } catch (e: unknown) {
      setError(errorText(e));
      setConflict(e instanceof ApiError && e.status === 409);
    } finally {
      setBusy(false);
    }
  }
  async function reloadNotes() {
    if (!current) return;
    setBusy(true);
    try {
      const result = await api<{ run: Run }>('/api/runs/' + current.id);
      inspect(result.run);
      setMessage('Loaded the saved note version.');
      setRevision((x) => x + 1);
    } catch (e: unknown) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function exportInput() {
    if (!current) return;
    const { name, model, dataset, seed, metrics } = current;
    const blob = new Blob(
      [JSON.stringify({ name, model, dataset, seed, metrics }, null, 2) + '\n'],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement('a');
    link.href = url;
    link.download = 'experiment-input.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const left = selected[0],
    right = selected[1];
  const metricKeys =
    left && right
      ? [...new Set([...Object.keys(left.metrics), ...Object.keys(right.metrics)])].sort()
      : [];
  return (
    <>
      <a className="skip" href="#main">
        Skip to saved experiments
      </a>
      <header className="top">
        <div>
          <p className="eyebrow">LOCAL RESEARCH WORKSPACE</p>
          <h1>Experiment Ledger</h1>
          <p className="subhead">Keep the inputs. Compare the evidence. Record the decision.</p>
        </div>
        <span className="badge">LOCAL ONLY / SQLITE</span>
      </header>
      <div className="feedback">
        <p role="status">{message}</p>
        {error && <p role="alert">{error}</p>}
      </div>
      <div className="layout">
        <aside className="stack">
          <section className="card" aria-labelledby="import-title">
            <p className="eyebrow">01 / INGEST</p>
            <h2 id="import-title">Import an experiment</h2>
            <p>Paste a run record. Identical inputs are stored only once.</p>
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                onClick={() => setInput(JSON.stringify(baseline, null, 2))}
              >
                Load baseline
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => setInput(JSON.stringify(candidate, null, 2))}
              >
                Load candidate
              </button>
            </div>
            <p className="hint">Examples are synthetic records, not measured model results.</p>
            <form onSubmit={(e) => void importRun(e)}>
              <label htmlFor="run-json">Experiment JSON</label>
              <textarea
                id="run-json"
                className="code"
                rows={14}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                spellCheck={false}
                maxLength={64000}
                placeholder={'{"name": "run-01", ...}'}
              />
              <button disabled={busy || !input.trim()} type="submit">
                Import experiment
              </button>
            </form>
          </section>
          <section className="card compact">
            <h2>Review protocol</h2>
            <p>
              Select a baseline, then a candidate. Deltas are candidate minus baseline; whether a
              change is better depends on the metric.
            </p>
            <p className="hint">
              No external API calls. Notes use version checks to prevent silent overwrites.
            </p>
          </section>
        </aside>
        <main id="main" className="stack" tabIndex={-1}>
          <section className="card" aria-labelledby="runs-title" aria-busy={loading}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">02 / INSPECT</p>
                <h2 id="runs-title">
                  Saved experiments <span className="count">{runs.length}</span>
                </h2>
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setError('');
                  setRevision((x) => x + 1);
                }}
              >
                Refresh
              </button>
            </div>
            <label htmlFor="filter">Filter runs</label>
            <input
              id="filter"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={200}
              placeholder="Name, model, or dataset"
            />
            {loading && <p className="hint">Loading saved experiments...</p>}
            {truncated && (
              <p className="hint">Showing the newest 200 matching runs. Refine the filter.</p>
            )}
            <div className="table-wrap">
              <table aria-label="Saved experiments">
                <thead>
                  <tr>
                    <th scope="col">Compare</th>
                    <th scope="col">Run / model</th>
                    <th scope="col">Dataset</th>
                    <th scope="col">Seed</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={'Select ' + run.name}
                          checked={selected.some((x) => x.id === run.id)}
                          disabled={selected.length === 2 && !selected.some((x) => x.id === run.id)}
                          onChange={() => toggle(run)}
                        />
                      </td>
                      <td>
                        <button
                          className="text-button"
                          aria-label={'Inspect ' + run.name}
                          onClick={() => inspect(run)}
                        >
                          {run.name}
                        </button>
                        <small>{run.model}</small>
                      </td>
                      <td className="break">{run.dataset}</td>
                      <td className="mono">{run.seed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!loading && runs.length === 0 && (
              <p className="empty">No saved runs match this filter.</p>
            )}
            <div className="selection">
              <span>{selected.length} of 2 comparison slots selected</span>
              {selected.length > 0 && (
                <button className="text-button" onClick={() => setSelected([])}>
                  Clear comparison
                </button>
              )}
            </div>
          </section>
          {left && right && (
            <section className="card" aria-labelledby="comparison-title">
              <p className="eyebrow">03 / COMPARE</p>
              <h2 id="comparison-title">Metric comparison</h2>
              <p>
                <strong>{left.name}</strong> to <strong>{right.name}</strong>
              </p>
              <div className="table-wrap">
                <table aria-label="Metric comparison">
                  <thead>
                    <tr>
                      <th scope="col">Metric</th>
                      <th scope="col">Baseline</th>
                      <th scope="col">Candidate</th>
                      <th scope="col">Delta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metricKeys.map((key) => {
                      const a = left.metrics[key],
                        b = right.metrics[key];
                      const delta = a !== undefined && b !== undefined ? b - a : undefined;
                      return (
                        <tr key={key}>
                          <th scope="row">{key}</th>
                          <td className="mono">{numeric(a)}</td>
                          <td className="mono">{numeric(b)}</td>
                          <td className="mono">
                            {delta === undefined
                              ? 'Not comparable'
                              : (delta > 0 ? '+' : '') + numeric(delta)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="hint">
                Missing metrics are not treated as zero. Values are displayed to seven significant
                digits.
              </p>
            </section>
          )}
          {current && (
            <section className="card" aria-labelledby="notes-title">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">04 / DOCUMENT</p>
                  <h2 id="notes-title">Research notes</h2>
                </div>
                <span className="badge">VERSION {current.version}</span>
              </div>
              <p className="break">{current.name}</p>
              <form onSubmit={(e) => void saveNotes(e)}>
                <label htmlFor="notes">Research notes</label>
                <textarea
                  id="notes"
                  rows={5}
                  value={notes}
                  maxLength={4000}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="What changed? What evidence supports the decision?"
                />
                <div className="button-row">
                  <button type="submit" disabled={busy}>
                    Save notes
                  </button>
                  {conflict && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => void reloadNotes()}
                    >
                      Reload saved notes
                    </button>
                  )}
                  <button type="button" className="secondary" onClick={exportInput}>
                    Export input JSON
                  </button>
                </div>
              </form>
              <p className="hint mono break">SHA-256 {current.digest}</p>
            </section>
          )}
        </main>
      </div>
      <footer>Experiment Ledger / Local single-user workspace / No hosted services</footer>
    </>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
