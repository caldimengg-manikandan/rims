"use client";

import { useState } from "react";
import { getApiBaseUrl } from "@/lib/config";

export default function DemoPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStartInterview = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      const apiUrl = getApiBaseUrl();
      const response = await fetch(`${apiUrl}/api/interviews/demo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to start demo interview: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.demo_url) {
        if (data.access_token) {
          sessionStorage.setItem("interview_token", data.access_token);
          document.cookie = `interview_token=${data.access_token}; path=/; max-age=14400; SameSite=Strict`;
        }
        window.location.href = data.demo_url;
      } else {
        throw new Error("Invalid response from server");
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Failed to start interview");
      setLoading(false);
    }
  };

  return (
    <main style={{ padding: "20px", fontFamily: "sans-serif" }}>
      <h1>Demo</h1>
      <nav>
        <ul>
          <li>
            <a 
              href="#interview" 
              onClick={handleStartInterview}
              style={{ cursor: loading ? "wait" : "pointer" }}
            >
              {loading ? "Starting Interview..." : "Interview"}
            </a>
          </li>
        </ul>
      </nav>
      {error && <p style={{ color: "red" }}>Error: {error}</p>}
    </main>
  );
}
