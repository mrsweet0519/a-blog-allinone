import { Navigate, Route, Routes } from "react-router-dom";
import { useState } from "react";
import AccessGate from "./components/AccessGate.jsx";
import AppLayout from "./components/AppLayout.jsx";
import CommentReplyManager from "./pages/CommentReplyManager.jsx";
import ContentMaker from "./pages/ContentMaker.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import ProductReviewMaker from "./pages/ProductReviewMaker.jsx";
import Settings from "./pages/Settings.jsx";
import Storage from "./pages/Storage.jsx";
import { clearAccessSession, loadAccessSession } from "./lib/accessControl.js";

export default function App() {
  const [accessSession, setAccessSession] = useState(() => loadAccessSession());
  const [accessMessage, setAccessMessage] = useState("");

  const handleAuthenticated = (session, message = "") => {
    setAccessSession(session);
    setAccessMessage(message);
  };

  const handleLogout = () => {
    clearAccessSession();
    setAccessSession(null);
    setAccessMessage("");
  };

  if (!accessSession) {
    return <AccessGate onAuthenticated={handleAuthenticated} />;
  }

  return (
    <AppLayout accessSession={accessSession} accessMessage={accessMessage} onLogout={handleLogout}>
      <Routes>
        <Route path="/" element={<ProductReviewMaker />} />
        <Route path="/app" element={<ProductReviewMaker />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/maker" element={<ContentMaker />} />
        <Route path="/product-review-maker" element={<ProductReviewMaker />} />
        <Route path="/comment-replies" element={<CommentReplyManager />} />
        <Route path="/storage" element={<Storage />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  );
}
