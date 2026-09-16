"use client";

import { useState, useEffect } from "react";
import { getApiBaseUrl } from "@/lib/config";

type RoundId = "aptitude" | "first_level" | "coding";

interface RoundOption {
  id: RoundId;
  label: string;
  desc: string;
}

interface CodingQuestionSetOption {
  id: number;
  title: string;
  description: string;
  supported_languages: string[];
  problem_count: number;
}

const AVAILABLE_ROUNDS: RoundOption[] = [
  { id: "aptitude", label: "Aptitude Round", desc: "10 MCQ aptitude questions (Junior / Intern)" },
  { id: "first_level", label: "First Level Interview", desc: "AI-driven technical and behavioral interview" },
  { id: "coding", label: "Coding Round", desc: "Sandboxed coding assessment with live test execution" },
];

const LANGUAGE_LABELS: Record<string, string> = {
  python3: "Python 3",
  java21: "Java 21",
  javascript: "JavaScript (Node.js)",
  typescript: "TypeScript",
  cpp17: "C++ 17",
  go: "Go",
  rust: "Rust",
};

export default function DemoPage() {
  const [selectedRounds, setSelectedRounds] = useState<RoundId[]>(["first_level"]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Coding round configuration state
  const [codingSets, setCodingSets] = useState<CodingQuestionSetOption[]>([]);
  const [selectedSetId, setSelectedSetId] = useState<number | null>(null);
  const [allowedLanguages, setAllowedLanguages] = useState<string[]>(["python3"]);
  const [problemCount, setProblemCount] = useState<number | "all">("all");
  const [durationMinutes, setDurationMinutes] = useState<number>(60);

  // Fetch coding question sets on mount
  useEffect(() => {
    const fetchCodingOptions = async () => {
      try {
        const apiUrl = getApiBaseUrl();
        const res = await fetch(`${apiUrl}/api/interviews/demo/coding-options`);
        if (res.ok) {
          const data = await res.json();
          if (data.question_sets && data.question_sets.length > 0) {
            setCodingSets(data.question_sets);
            const firstSet = data.question_sets[0];
            setSelectedSetId(firstSet.id);
            setAllowedLanguages(firstSet.supported_languages || ["python3"]);
          }
        }
      } catch (err) {
        console.error("Failed to fetch demo coding options:", err);
      }
    };
    fetchCodingOptions();
  }, []);

  const handleSetChange = (newSetId: number) => {
    setSelectedSetId(newSetId);
    const chosen = codingSets.find((s) => s.id === newSetId);
    if (chosen && chosen.supported_languages && chosen.supported_languages.length > 0) {
      setAllowedLanguages(chosen.supported_languages);
    }
  };

  const handleLanguageToggle = (lang: string) => {
    setAllowedLanguages((prev) =>
      prev.includes(lang) ? prev.filter((l) => l !== lang) : [...prev, lang]
    );
  };

  const handleToggle = (id: RoundId) => {
    setSelectedRounds((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );
  };

  const isCodingSelected = selectedRounds.includes("coding");
  const currentSet = codingSets.find((s) => s.id === selectedSetId);

  const handleStartInterview = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (loading) return;
    if (selectedRounds.length === 0) {
      setError("Please select at least one round.");
      return;
    }
    if (isCodingSelected && allowedLanguages.length === 0) {
      setError("Please select at least one allowed programming language for the coding round.");
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const apiUrl = getApiBaseUrl();
      const ORDERED: RoundId[] = ["aptitude", "first_level", "coding"];
      const orderedRounds = ORDERED.filter((r) => selectedRounds.includes(r));

      const payload: Record<string, any> = {
        rounds: orderedRounds,
      };

      if (isCodingSelected) {
        if (selectedSetId) payload.coding_repo_set_id = selectedSetId;
        if (allowedLanguages.length > 0) payload.coding_allowed_languages = allowedLanguages;
        if (problemCount !== "all") payload.coding_problem_count = problemCount;
        payload.coding_round_duration_minutes = durationMinutes;
      }

      const response = await fetch(`${apiUrl}/api/interviews/demo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `Failed to start demo interview: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.demo_url) {
        if (data.access_token) {
          sessionStorage.setItem("interview_token", data.access_token);
          document.cookie = `interview_token=${data.access_token}; path=/; max-age=14400; SameSite=Lax`;
          document.cookie = `interview_token=${data.access_token}; path=/calrims; max-age=14400; SameSite=Lax`;
        }
        if (data.proctoring_secret) {
          sessionStorage.setItem("proctoring_secret", data.proctoring_secret);
        }
        const targetUrl = data.demo_url.includes("token=")
          ? data.demo_url
          : `${data.demo_url}${data.demo_url.includes("?") ? "&" : "?"}token=${data.access_token}`;
        window.location.href = targetUrl;
      } else {
        throw new Error("Invalid response from server");
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Failed to start interview");
      setLoading(false);
    }
  };

  const ORDERED: RoundId[] = ["aptitude", "first_level", "coding"];
  const activeOrder = ORDERED.filter((r) => selectedRounds.includes(r));

  return (
    <main style={{ padding: "30px", fontFamily: "system-ui, sans-serif", maxWidth: "620px", margin: "0 auto", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: "28px", marginBottom: "8px" }}>Demo</h1>
      <p style={{ color: "#666", marginBottom: "20px" }}>
        Configure and launch a demo interview session:
      </p>

      {/* Rounds Selection */}
      <fieldset style={{ border: "1px solid #ccc", borderRadius: "8px", padding: "16px 20px", marginBottom: "20px" }}>
        <legend style={{ fontWeight: "600", padding: "0 6px" }}>Choose Interview Rounds</legend>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "8px" }}>
          {AVAILABLE_ROUNDS.map((round) => {
            const isChecked = selectedRounds.includes(round.id);
            return (
              <label
                key={round.id}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  cursor: "pointer",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  backgroundColor: isChecked ? "#f0f4ff" : "transparent",
                  border: isChecked ? "1px solid #c7d2fe" : "1px solid transparent",
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => handleToggle(round.id)}
                  style={{ marginTop: "4px", cursor: "pointer" }}
                />
                <div>
                  <div style={{ fontWeight: "600", color: isChecked ? "#1d4ed8" : "inherit" }}>
                    {round.label}
                  </div>
                  <div style={{ fontSize: "13px", color: "#666" }}>
                    {round.desc}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Coding Round Configuration - Visible when Coding Round is selected */}
      {isCodingSelected && (
        <fieldset style={{ border: "1px solid #93c5fd", backgroundColor: "#f8fafc", borderRadius: "8px", padding: "16px 20px", marginBottom: "20px" }}>
          <legend style={{ fontWeight: "600", padding: "0 6px", color: "#1e40af" }}>
            Coding Round Settings
          </legend>

          {/* Question Set selection */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontWeight: "600", fontSize: "14px", marginBottom: "6px" }}>
              Question Set:
            </label>
            {codingSets.length > 0 ? (
              <select
                value={selectedSetId || ""}
                onChange={(e) => handleSetChange(Number(e.target.value))}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  backgroundColor: "#fff",
                  fontSize: "14px",
                  cursor: "pointer",
                }}
              >
                {codingSets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} ({s.problem_count} {s.problem_count === 1 ? "problem" : "problems"})
                  </option>
                ))}
              </select>
            ) : (
              <p style={{ fontSize: "13px", color: "#64748b" }}>Loading question sets...</p>
            )}
            {currentSet?.description && (
              <p style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>{currentSet.description}</p>
            )}
          </div>

          {/* Allowed Languages */}
          <div style={{ marginBottom: "16px" }}>
            <label style={{ display: "block", fontWeight: "600", fontSize: "14px", marginBottom: "6px" }}>
              Allowed Programming Languages:
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
              {(currentSet?.supported_languages && currentSet.supported_languages.length > 0
                ? currentSet.supported_languages
                : ["python3", "java21", "javascript"]
              ).map((lang) => {
                const checked = allowedLanguages.includes(lang);
                return (
                  <label
                    key={lang}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      fontSize: "13px",
                      cursor: "pointer",
                      padding: "4px 8px",
                      borderRadius: "4px",
                      backgroundColor: checked ? "#dbeafe" : "#fff",
                      border: checked ? "1px solid #bfdbfe" : "1px solid #e2e8f0",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => handleLanguageToggle(lang)}
                    />
                    <span>{LANGUAGE_LABELS[lang] || lang}</span>
                  </label>
                );
              })}
            </div>
            {allowedLanguages.length === 0 && (
              <p style={{ fontSize: "12px", color: "#ef4444", marginTop: "4px" }}>
                Select at least one language.
              </p>
            )}
          </div>

          {/* Number of Problems & Duration */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <label style={{ display: "block", fontWeight: "600", fontSize: "14px", marginBottom: "6px" }}>
                Problem Count:
              </label>
              <select
                value={problemCount}
                onChange={(e) => {
                  const val = e.target.value;
                  setProblemCount(val === "all" ? "all" : Number(val));
                }}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  backgroundColor: "#fff",
                  fontSize: "14px",
                }}
              >
                <option value="all">
                  All in set ({currentSet?.problem_count || 1})
                </option>
                {Array.from({ length: currentSet?.problem_count || 1 }, (_, i) => i + 1).map((cnt) => (
                  <option key={cnt} value={cnt}>
                    {cnt} {cnt === 1 ? "problem" : "problems"}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontWeight: "600", fontSize: "14px", marginBottom: "6px" }}>
                Duration (minutes):
              </label>
              <select
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  backgroundColor: "#fff",
                  fontSize: "14px",
                }}
              >
                <option value={15}>15 minutes (Quick test)</option>
                <option value={30}>30 minutes</option>
                <option value={45}>45 minutes</option>
                <option value={60}>60 minutes (Standard)</option>
                <option value={90}>90 minutes</option>
                <option value={120}>120 minutes</option>
              </select>
            </div>
          </div>
        </fieldset>
      )}

      {/* Pipeline Order preview */}
      {activeOrder.length > 0 && (
        <div style={{ marginBottom: "20px", fontSize: "14px", color: "#444", padding: "10px 14px", backgroundColor: "#f9fafb", borderRadius: "6px", border: "1px solid #e5e7eb" }}>
          <strong>Pipeline Order:</strong>{" "}
          {activeOrder.map((r) => AVAILABLE_ROUNDS.find((o) => o.id === r)?.label).join(" → ")}
        </div>
      )}

      {/* Action Button */}
      <nav>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          <li>
            <a
              href="#interview"
              onClick={handleStartInterview}
              style={{
                display: "inline-block",
                padding: "10px 22px",
                backgroundColor: loading ? "#9ca3af" : "#2563eb",
                color: "#ffffff",
                textDecoration: "none",
                borderRadius: "6px",
                fontWeight: "600",
                cursor: loading ? "wait" : "pointer",
              }}
            >
              {loading ? "Starting Interview..." : "Interview"}
            </a>
          </li>
        </ul>
      </nav>

      {error && <p style={{ color: "#dc2626", marginTop: "16px", fontWeight: "500" }}>Error: {error}</p>}
    </main>
  );
}
