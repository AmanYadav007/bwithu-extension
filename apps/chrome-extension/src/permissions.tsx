/* eslint-disable react-refresh/only-export-components */
import ReactDOM from "react-dom/client";
import { useEffect, useState, useCallback } from "react";
import "./index.css";

function PermissionsApp() {
  const [status, setStatus] = useState<"requesting" | "granted" | "denied">("requesting");
  const [errorMsg, setErrorMsg] = useState("");

  const requestPermission = useCallback(async () => {
    setStatus("requesting");
    setErrorMsg("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      // Stop the stream immediately to turn off the recording indicator
      stream.getTracks().forEach((track) => track.stop());
      setStatus("granted");
      
      // Auto close after 1 second so they see the success message
      setTimeout(() => {
        window.close();
      }, 1000);
    } catch (err) {
      console.error("Microphone setup failed:", err);
      setStatus("denied");
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    // Automatically trigger on load asynchronously to avoid set-state-in-effect warning
    const timer = setTimeout(() => {
      void requestPermission();
    }, 0);
    return () => clearTimeout(timer);
  }, [requestPermission]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        width: "100vw",
        padding: "20px",
        boxSizing: "border-box",
        background: "radial-gradient(circle at 50% 30%, #1e1713 0%, #080605 100%)",
        color: "#f8fafc",
        fontFamily: "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        className="bwithu-panel"
        style={{
          width: "100%",
          maxWidth: "480px",
          padding: "32px",
          boxSizing: "border-box",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "24px",
          position: "relative",
          background: "rgba(22, 18, 16, 0.72)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "24px",
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.4)",
        }}
      >
        {/* Animated holographic scanline background effect */}
        <div className="bwithu-tv-scanlines" style={{ borderRadius: "24px" }} aria-hidden="true" />

        {/* Dynamic Glowing Mic Status Indicator */}
        <div
          style={{
            width: "80px",
            height: "80px",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "36px",
            background:
              status === "granted"
                ? "rgba(16, 185, 129, 0.12)"
                : status === "denied"
                  ? "rgba(239, 68, 68, 0.12)"
                  : "rgba(245, 158, 11, 0.12)",
            border:
              status === "granted"
                ? "2px solid rgba(16, 185, 129, 0.45)"
                : status === "denied"
                  ? "2px solid rgba(239, 68, 68, 0.45)"
                  : "2px solid rgba(245, 158, 11, 0.45)",
            boxShadow:
              status === "granted"
                ? "0 0 24px rgba(16, 185, 129, 0.22)"
                : status === "denied"
                  ? "0 0 24px rgba(239, 68, 68, 0.22)"
                  : "0 0 24px rgba(245, 158, 11, 0.22)",
            transition: "all 0.3s ease",
            zIndex: 2,
          }}
        >
          {status === "granted" ? "🟢" : status === "denied" ? "🔴" : "🎙️"}
        </div>

        <div style={{ zIndex: 2 }}>
          <h2 style={{ fontSize: "20px", fontWeight: "bold", margin: "0 0 10px 0", color: "#f8fafc" }}>
            {status === "granted"
              ? "Microphone Permission Granted!"
              : status === "denied"
                ? "Microphone Permission Denied"
                : "Microphone Access Setup"}
          </h2>
          <p style={{ fontSize: "14px", color: "#94a3b8", lineHeight: "1.6", margin: 0 }}>
            {status === "granted"
              ? "BwithU is now fully authorized. Closing this tab automatically..."
              : status === "denied"
                ? "We couldn't access your microphone. Please reset the permission toggle using the mic icon in your address bar and try again."
                : "BwithU needs microphone permission so you can have continuous, hands-free voice chats with your AI companion."}
          </p>
        </div>

        {status === "denied" && (
          <div
            style={{
              width: "100%",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              zIndex: 2,
              marginTop: "8px",
            }}
          >
            {errorMsg && (
              <p style={{ fontSize: "11px", color: "#f87171", margin: "0 0 8px 0", fontFamily: "monospace" }}>
                Error: {errorMsg}
              </p>
            )}
            <button
              onClick={requestPermission}
              style={{
                background: "#0284c7",
                border: 0,
                borderRadius: "12px",
                color: "#ffffff",
                fontSize: "14px",
                fontWeight: "600",
                padding: "12px 24px",
                cursor: "pointer",
                transition: "all 0.15s ease",
                boxShadow: "0 4px 12px rgba(2, 132, 199, 0.24)",
              }}
            >
              Try Again
            </button>
          </div>
        )}

        {status === "requesting" && (
          <div
            style={{
              fontSize: "12px",
              color: "#f59e0b",
              background: "rgba(245, 158, 11, 0.08)",
              border: "1px solid rgba(245, 158, 11, 0.15)",
              borderRadius: "8px",
              padding: "8px 16px",
              zIndex: 2,
            }}
          >
            Please click "Allow" in the browser popup prompt.
          </div>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("permissions-root")!).render(<PermissionsApp />);
