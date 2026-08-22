import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[tempo error boundary]", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            width: "100vw",
            background: "var(--bg, #121316)",
            color: "var(--text, #f0f0f2)",
            fontFamily: "system-ui, sans-serif",
            padding: 24,
            textAlign: "center",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              maxWidth: 420,
              padding: 32,
              borderRadius: 16,
              background: "var(--surface, #1b1c20)",
              border: "1px solid var(--border, #2a2b30)",
              boxShadow: "0 12px 36px rgba(0,0,0,0.4)",
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                background: "rgba(239, 68, 68, 0.15)",
                color: "#ef4444",
                display: "grid",
                placeItems: "center",
              }}
            >
              <AlertTriangle size={24} />
            </div>

            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
              Bir şeyler ters gitti
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "var(--muted, #8b8d98)",
                lineHeight: 1.5,
              }}
            >
              Uygulama çalışırken beklenmedik bir durum oluştu. Yeniden başlatarak devam edebilirsiniz.
            </p>

            <button
              type="button"
              onClick={this.handleReload}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 20px",
                borderRadius: 8,
                background: "var(--accent, #6366f1)",
                color: "#fff",
                border: "none",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
                marginTop: 8,
              }}
            >
              <RefreshCw size={14} />
              Yeniden Başlat
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
