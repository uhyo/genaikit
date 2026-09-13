import { useMemo, useState } from "react";
import { useIncrementalJsx } from "jsx-incremental-parser/react";

import { componentNames, demoComponents } from "./components";
import { samples } from "./samples";
import { createCharStream } from "./streaming";

/** Frontier placeholder: a shimmering block shown wherever content is pending. */
function Shimmer() {
  return <span className="shimmer" aria-label="loading" />;
}

interface RunParams {
  key: number;
  text: string;
  intervalMs: number;
  chunkSize: number;
}

const SPEEDS = [
  { label: "Slow", intervalMs: 90, chunkSize: 1 },
  { label: "Normal", intervalMs: 45, chunkSize: 2 },
  { label: "Fast", intervalMs: 16, chunkSize: 4 },
];

export function App() {
  const [text, setText] = useState(samples[0]!.jsx);
  const [speedIndex, setSpeedIndex] = useState(1);
  const [run, setRun] = useState<RunParams | null>(null);

  const startStream = () => {
    const speed = SPEEDS[speedIndex]!;
    setRun({
      key: Date.now(),
      text,
      intervalMs: speed.intervalMs,
      chunkSize: speed.chunkSize,
    });
  };

  return (
    <div className="page">
      <header className="masthead">
        <h1>
          jsx-incremental-parser <span className="masthead__dot">●</span> live demo
        </h1>
        <p>
          A streamed JSX string is parsed into a <strong>live React tree</strong>. Whatever has not
          arrived yet is a single <code>&lt;Pending /&gt;</code> placeholder at the streaming
          frontier — rendered here as a shimmer.
        </p>
      </header>

      <section className="panel">
        <div className="panel__toolbar">
          <label className="field">
            <span>Sample</span>
            <select
              value=""
              onChange={(e) => {
                const sample = samples.find((s) => s.id === e.target.value);
                if (sample) setText(sample.jsx);
              }}
            >
              <option value="" disabled>
                Load a sample…
              </option>
              {samples.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Speed</span>
            <select value={speedIndex} onChange={(e) => setSpeedIndex(Number(e.target.value))}>
              {SPEEDS.map((s, i) => (
                <option key={s.label} value={i}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <button className="run" type="button" onClick={startStream}>
            {run ? "↻ Replay stream" : "▶ Stream it"}
          </button>
        </div>

        <textarea
          className="editor"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label="JSX source to stream"
        />
        <p className="hint">
          Allowed components (the parser doubles as a security allowlist):{" "}
          {componentNames.map((n) => (
            <code key={n}>{n}</code>
          ))}
        </p>
      </section>

      {run ? (
        <StreamView key={run.key} params={run} />
      ) : (
        <section className="empty">Press “Stream it” to start.</section>
      )}
    </div>
  );
}

function StreamView({ params }: { params: RunParams }) {
  const [streamed, setStreamed] = useState("");
  const [errors, setErrors] = useState<{ id: number; message: string }[]>([]);

  // Remounted on every run (parent `key`), so the stream is created exactly once
  // per run — each parser gets its own fresh, single-use source.
  const stream = useMemo(
    () =>
      createCharStream(params.text, {
        intervalMs: params.intervalMs,
        chunkSize: params.chunkSize,
        onProgress: setStreamed,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const node = useIncrementalJsx(stream, {
    components: demoComponents,
    Pending: Shimmer,
    onUnknownComponent: "pending",
    onJsxError: (event) =>
      setErrors((prev) => [...prev, { id: prev.length, message: event.message }]),
  });

  const done = streamed === params.text;
  const progress = params.text.length === 0 ? 1 : streamed.length / params.text.length;

  return (
    <section className="stage">
      <div className="stage__panes">
        <div className="pane">
          <div className="pane__head">
            <span>Received stream</span>
            <span className={`status ${done ? "status--done" : "status--live"}`}>
              {done ? "complete" : "streaming…"}
            </span>
          </div>
          <pre className="stream-text">
            {streamed}
            {!done && <span className="caret" />}
          </pre>
        </div>

        <div className="pane">
          <div className="pane__head">
            <span>Live React tree</span>
            {!done && <span className="status status--live">+ &lt;Pending /&gt;</span>}
          </div>
          <div className="render-surface">{node}</div>
        </div>
      </div>

      <div className="progress">
        <div className="progress__bar" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>

      {errors.length > 0 && (
        <div className="errors">
          <strong>onJsxError ({errors.length}):</strong>
          <ul>
            {errors.map((err) => (
              <li key={err.id}>{err.message}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
