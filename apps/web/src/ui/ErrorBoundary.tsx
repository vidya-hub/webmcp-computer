import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

// Wraps the Shell so a render throw in one panel can't unmount the whole app
// (e.g. leaving Approve unreachable). Shows a minimal recover affordance.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("UI error boundary:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="overlay">
          <div className="sheet" role="alertdialog" aria-modal="true">
            <div className="sheet-mark">Error</div>
            <h2>Something broke on the page</h2>
            <p className="sheet-body">
              {this.state.error.message || "An unexpected error occurred."}
            </p>
            <div className="sheet-actions">
              <button
                type="button"
                className="btn-approve"
                onClick={() => location.reload()}
              >
                Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
