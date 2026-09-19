import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/theme.css";
import "./styles/base.css";
import "./styles/feed.css";

/* last line of defence: a render throw anywhere below here would otherwise
 * unmount the tree and leave a blank screen with no way back. */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="screen">
        <header className="chrome">
          <h1 className="wordmark">nexus</h1>
        </header>
        <div className="viewport">
          <section className="section">
            <p className="status-line">
              something broke —{" "}
              <button type="button" className="chip" onClick={() => window.location.reload()}>
                reload
              </button>
            </p>
          </section>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
