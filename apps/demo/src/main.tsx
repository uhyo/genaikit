import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles.css";

// Note: intentionally not wrapped in <StrictMode>. A stream source is single-use,
// and StrictMode's dev double-invocation would consume/cancel it before the real
// run (see the `useIncrementalJsx` docs). The library itself is StrictMode-safe
// when given a *stable* source; the demo creates a fresh stream per run.
const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

createRoot(container).render(<App />);
