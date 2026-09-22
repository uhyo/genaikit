import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useIncrementalJsx } from "@ingenui/incremental-jsx-parser/react";
import type { GenUiIssue } from "ingenui";
import { useGenUiMessage } from "ingenui/react";

import { componentNames, demoComponents } from "./components";
import { jsxSamples, markdownSamples, type Sample } from "./samples";
import { createCharStream } from "./streaming";

/** Frontier placeholder: a shimmering block shown wherever content is pending. */
function Shimmer() {
  return <span className="shimmer" aria-label="loading" />;
}

type Mode = "genui" | "jsx";

interface ModeInfo {
  id: Mode;
  label: string;
  samples: Sample[];
}

const MODES: ModeInfo[] = [
  { id: "genui", label: "ingenui · Markdown + ui+jsx", samples: markdownSamples },
  { id: "jsx", label: "parser · raw JSX", samples: jsxSamples },
];

interface RunParams {
  key: number;
  mode: Mode;
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
  const [mode, setMode] = useState<Mode>("genui");
  const [text, setText] = useState(markdownSamples[0]!.source);
  const [speedIndex, setSpeedIndex] = useState(1);
  const [run, setRun] = useState<RunParams | null>(null);

  const modeInfo = MODES.find((m) => m.id === mode)!;

  const switchMode = (next: ModeInfo) => {
    if (next.id === mode) return;
    setMode(next.id);
    setText(next.samples[0]!.source);
  };

  const startStream = () => {
    const speed = SPEEDS[speedIndex]!;
    setRun({
      key: Date.now(),
      mode,
      text,
      intervalMs: speed.intervalMs,
      chunkSize: speed.chunkSize,
    });
  };

  return (
    <div className="page">
      <header className="masthead">
        <h1>
          Generative UI toolchain <span className="masthead__dot">●</span> live demo
        </h1>
        <p>
          A streamed message becomes a <strong>live React tree</strong>. In ingenui mode the stream
          is Markdown where <code>```ui+jsx</code> code fences render as interactive UI (with{" "}
          <code>actions.*</code> wiring events back to the conversation); in parser mode it is raw
          JSX. Either way, what has not arrived yet is a single <code>&lt;Pending /&gt;</code>{" "}
          shimmer at the streaming frontier.
        </p>
      </header>

      <section className="panel">
        <div className="mode" role="tablist" aria-label="Demo mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={m.id === mode}
              className={`mode__tab ${m.id === mode ? "mode__tab--active" : ""}`}
              onClick={() => switchMode(m)}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="panel__toolbar">
          <label className="field">
            <span>Sample</span>
            <select
              value=""
              onChange={(e) => {
                const sample = modeInfo.samples.find((s) => s.id === e.target.value);
                if (sample) setText(sample.source);
              }}
            >
              <option value="" disabled>
                Load a sample…
              </option>
              {modeInfo.samples.map((s) => (
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
          aria-label="Source to stream"
        />
        <p className="hint">
          Allowed components (the parser doubles as a security allowlist):{" "}
          {componentNames.map((n) => (
            <code key={n}>{n}</code>
          ))}
          {mode === "genui" && (
            <>
              {" "}
              — and <code>actions.*</code> names are model-defined (dynamic actions, the default).
            </>
          )}
        </p>
      </section>

      {run ? (
        run.mode === "genui" ? (
          <GenUiStreamView key={run.key} params={run} />
        ) : (
          <JsxStreamView key={run.key} params={run} />
        )
      ) : (
        <section className="empty">Press “Stream it” to start.</section>
      )}
    </div>
  );
}

/** The received-stream pane + progress bar shared by both modes. */
function StreamPanes({
  params,
  streamed,
  paneTitle,
  children,
}: {
  params: RunParams;
  streamed: string;
  paneTitle: string;
  children: ReactNode;
}) {
  const done = streamed === params.text;
  const progress = params.text.length === 0 ? 1 : streamed.length / params.text.length;
  return (
    <>
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
            <span>{paneTitle}</span>
            {!done && <span className="status status--live">+ &lt;Pending /&gt;</span>}
          </div>
          <div className="render-surface">{children}</div>
        </div>
      </div>

      <div className="progress">
        <div className="progress__bar" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
    </>
  );
}

function JsxStreamView({ params }: { params: RunParams }) {
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

  return (
    <section className="stage">
      <StreamPanes params={params} streamed={streamed} paneTitle="Live React tree">
        {node}
      </StreamPanes>

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

function issueLabel(issue: GenUiIssue): string {
  const block = `block ${issue.blockIndex + 1}`;
  switch (issue.kind) {
    case "jsx-error":
      return `${block}: ${issue.event.message}`;
    case "render-error":
      return `${block}: rendering crashed (${
        issue.error instanceof Error ? issue.error.message : String(issue.error)
      })`;
    case "unclosed-fence":
      return `${block}: the ui+jsx fence was never closed`;
  }
}

function GenUiStreamView({ params }: { params: RunParams }) {
  const [streamed, setStreamed] = useState("");
  const [issues, setIssues] = useState<{ id: number; message: string }[]>([]);
  const [actionLog, setActionLog] = useState<{ id: number; message: string }[]>([]);
  const [report, setReport] = useState<string | null>(null);

  // Remounted per run (parent `key`): one single-use stream per message.
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

  const { node, message } = useGenUiMessage(stream, {
    components: demoComponents,
    Pending: Shimmer,
    onUnknownComponent: "pending",
    // Dynamic actions are the default: the samples' actions.* names need no
    // declaration here — firing one only emits the next-request message.
    onAction: (event) =>
      setActionLog((prev) => [...prev, { id: prev.length, message: event.message }]),
    onIssue: (issue) =>
      setIssues((prev) => [...prev, { id: prev.length, message: issueLabel(issue) }]),
    renderUiError: (blockIndex) => (
      <div className="ui-callout ui-callout--info">UI block {blockIndex + 1} hidden (crashed)</div>
    ),
  });

  // When the message completes, surface the formatted feedback for the model.
  useEffect(() => {
    let alive = true;
    message.done.then(
      () => {
        if (alive) setReport(message.getIssueReport());
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [message]);

  return (
    <section className="stage">
      <StreamPanes params={params} streamed={streamed} paneTitle="Live message">
        {node}
      </StreamPanes>

      {actionLog.length > 0 && (
        <div className="action-log">
          <strong>Next request to the AI (onAction):</strong>
          <ul>
            {actionLog.map((entry) => (
              <li key={entry.id}>{entry.message}</li>
            ))}
          </ul>
        </div>
      )}

      {issues.length > 0 && (
        <div className="errors">
          <strong>Issues ({issues.length}):</strong>
          <ul>
            {issues.map((issue) => (
              <li key={issue.id}>{issue.message}</li>
            ))}
          </ul>
        </div>
      )}

      {report !== null && (
        <div className="report">
          <strong>Feedback report for the model (getIssueReport):</strong>
          <pre>{report}</pre>
        </div>
      )}
    </section>
  );
}
