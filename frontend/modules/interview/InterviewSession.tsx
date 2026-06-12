'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import QuestionPanel from './QuestionPanel';
import AnswerInput from './AnswerInput';
import ScoreIndicator from './ScoreIndicator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getApiBaseUrl } from '@/lib/config';
import { toast } from 'sonner';
import { APIClient } from '@/app/dashboard/lib/api-client';

import * as tf from '@tensorflow/tfjs-core';
import '@tensorflow/tfjs-backend-webgl';
import '@tensorflow/tfjs-converter';
import * as blazeface from '@tensorflow-models/blazeface';
import * as faceLandmarksDetection from '@tensorflow-models/face-landmarks-detection';
import {
  Loader2, ShieldCheck, ShieldAlert,
  UserCheck, Eye, BrainCircuit, CheckCircle2, Trophy, LogOut, CameraOff, AlertTriangle
} from 'lucide-react';
import InterviewSidebar from './InterviewSidebar';
import { FeedbackDialog, IssueReportDialog } from '@/components/interview-support';

// TF Hub default URL redirects to Kaggle (404) — serve the model from our own origin instead.
const BLAZEFACE_MODEL_URL = '/calrims/models/blazeface/model.json';

async function loadFaceDetector() {
  await tf.setBackend('webgl');
  await tf.ready();
  try {
    const model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
    const detector = await faceLandmarksDetection.createDetector(model, {
      runtime: 'tfjs',
      refineLandmarks: true,
    });
    console.info('[FaceCheck] FaceLandmarksDetection (FaceMesh) loaded successfully.');
    return { type: 'facemesh', detector };
  } catch (err) {
    console.warn('[FaceCheck] Failed to load FaceMesh landmarks detector, falling back to BlazeFace:', err);
    const detector = await blazeface.load({ modelUrl: BLAZEFACE_MODEL_URL });
    console.info('[FaceCheck] BlazeFace fallback loaded successfully.');
    return { type: 'blazeface', detector };
  }
}

interface InterviewSessionProps {
  sessionId: string;
  token: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────
function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function apiFetch(path: string, token: string, opts: RequestInit = {}) {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...opts,
    headers: { ...authHeaders(token), ...(opts.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || err.error || 'Request failed');
  }
  return res.json();
}

function captureFrame(video: HTMLVideoElement | null): string | null {
  if (!video || video.readyState < 2 || video.videoWidth === 0) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // 0.6 quality JPEG provides a beautifully detailed snapshot at a tiny footprint (<100KB)
    return canvas.toDataURL('image/jpeg', 0.6);
  } catch (err) {
    console.error('Failed to capture frame snapshot:', err);
    return null;
  }
}

// ─── IndexedDB video chunk helpers for resilience ───────────────────────────
function getDBInstance(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const request = window.indexedDB.open('rims-proctoring-db', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('video-chunks')) {
        db.createObjectStore('video-chunks');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveChunksToIndexedDB(interviewId: string, chunks: Blob[]) {
  try {
    const db = await getDBInstance();
    const tx = db.transaction('video-chunks', 'readwrite');
    const store = tx.objectStore('video-chunks');
    store.put(chunks, interviewId);
    await new Promise((resolve) => { tx.oncomplete = resolve; });
  } catch (err) {
    console.warn('Failed to save chunks to IndexedDB:', err);
  }
}

async function loadChunksFromIndexedDB(interviewId: string): Promise<Blob[] | null> {
  try {
    const db = await getDBInstance();
    const tx = db.transaction('video-chunks', 'readonly');
    const store = tx.objectStore('video-chunks');
    const request = store.get(interviewId);
    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  } catch (err) {
    return null;
  }
}

async function clearChunksFromIndexedDB(interviewId: string) {
  try {
    const db = await getDBInstance();
    const tx = db.transaction('video-chunks', 'readwrite');
    const store = tx.objectStore('video-chunks');
    store.delete(interviewId);
    await new Promise((resolve) => { tx.oncomplete = resolve; });
  } catch (err) {}
}

// ─── Brightness Calculation helper ───────────────────────────────────────────
function getAverageBrightness(video: HTMLVideoElement): number {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 30;
    canvas.height = 30;
    const ctx = canvas.getContext('2d');
    if (!ctx) return 127;
    ctx.drawImage(video, 0, 0, 30, 30);
    const imgData = ctx.getImageData(0, 0, 30, 30);
    const data = imgData.data;
    let colorSum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i+1];
      const b = data[i+2];
      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      colorSum += brightness;
    }
    return colorSum / (30 * 30);
  } catch (e) {
    return 127;
  }
}

function calculateVariance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  return values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
}

function computeFaceEmbedding(landmarks: number[][]): number[] {
  const distances: number[] = [];
  for (let i = 0; i < landmarks.length; i++) {
    for (let j = i + 1; j < landmarks.length; j++) {
      const dx = landmarks[i][0] - landmarks[j][0];
      const dy = landmarks[i][1] - landmarks[j][1];
      distances.push(Math.sqrt(dx * dx + dy * dy));
    }
  }
  const magnitude = Math.sqrt(distances.reduce((sum, d) => sum + d * d, 0));
  return distances.map(d => d / (magnitude || 1));
}

function cosineSimilarity(v1: number[], v2: number[]): number {
  if (v1.length !== v2.length) return 0;
  let dotProduct = 0;
  for (let i = 0; i < v1.length; i++) {
    dotProduct += v1[i] * v2[i];
  }
  return dotProduct;
}

async function computeHMAC(message: string, secret: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(message);
    const cryptoKey = await window.crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signatureBuffer = await window.crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      messageData
    );
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    return signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    let h = 0;
    for (let i = 0; i < message.length; i++) {
      h = (h * 31 + message.charCodeAt(i)) & 0xFFFFFFFF;
    }
    return (h >>> 0).toString(16);
  }
}

function detectPhoneHeuristic(video: HTMLVideoElement, topLeft: any, bottomRight: any): boolean {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 40;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(video, 0, 0, 40, 40);
    const imgData = ctx.getImageData(0, 0, 40, 40);
    const data = imgData.data;
    
    let phoneScore = 0;
    for (let y = 5; y < 35; y++) {
      for (let x = 5; x < 35; x++) {
        const idx = (y * 40 + x) * 4;
        const currentLuma = 0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2];
        const rightLuma = 0.299 * data[idx+4] + 0.587 * data[idx+5] + 0.114 * data[idx+6];
        const downLuma = 0.299 * data[((y+1)*40 + x)*4] + 0.587 * data[((y+1)*40 + x)*4+1] + 0.114 * data[((y+1)*40 + x)*4+2];
        
        const edgeX = Math.abs(currentLuma - rightLuma);
        const edgeY = Math.abs(currentLuma - downLuma);
        
        if (edgeX > 40 || edgeY > 40) {
          phoneScore++;
        }
      }
    }
    return phoneScore > 120;
  } catch (e) {
    return false;
  }
}

// ─── component ────────────────────────────────────────────────────────────────
function getFaceQuality(prediction: any, video: HTMLVideoElement) {
  const topLeft = prediction?.topLeft || [0, 0];
  const bottomRight = prediction?.bottomRight || [0, 0];
  const left = Number(topLeft[0] ?? 0);
  const top = Number(topLeft[1] ?? 0);
  const right = Number(bottomRight[0] ?? 0);
  const bottom = Number(bottomRight[1] ?? 0);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  const frameArea = Math.max(1, video.videoWidth * video.videoHeight);
  const areaRatio = (width * height) / frameArea;
  const rawProbability = prediction?.probability;
  let confidence = 0;
  if (typeof rawProbability === 'number') {
    confidence = rawProbability;
  } else if (Array.isArray(rawProbability)) {
    const first = rawProbability[0];
    confidence = typeof first === 'number' ? first : Number(first?.[0] ?? 0);
  }
  const hasReasonableSize = areaRatio >= 0.035;
  const isInsideFrame = left >= 0 && top >= 0 && right <= video.videoWidth && bottom <= video.videoHeight;

  return {
    confidence,
    inFocus: confidence >= 0.75 && hasReasonableSize && isInsideFrame,
  };
}

export default function InterviewSession({ sessionId, token }: InterviewSessionProps) {
  const interviewId = sessionId;

  // ── session state ──
  const [isStarted, setIsStarted] = useState(false);  // candidate clicked start
  const [isReady, setIsReady] = useState(false);       // questions loaded
  const [isLoading, setIsLoading] = useState(true);    // first load spinner
  const [isQuestionSwapping, setIsQuestionSwapping] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [isTerminated, setIsTerminated] = useState(false);
  const [isDeviceTestSuccess, setIsDeviceTestSuccess] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [deviceTestError, setDeviceTestError] = useState<string | null>(null);
  const [terminationReason, setTerminationReason] = useState<string | null>(null);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [pollTrigger, setPollTrigger] = useState(0);
  const [focusStrikes, setFocusStrikes] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = sessionStorage.getItem(`strikes_${sessionId}`);
      return saved ? parseInt(saved, 10) : 0;
    }
    return 0;
  });
  const [isCameraConnected, setIsCameraConnected] = useState(true);
  const lastStrikeTimeRef = useRef(0);
  const sessionStartRef = useRef(Date.now());
  // Shadow isStarted in a ref so handleStrike stays stable across isStarted changes
  const isStartedRef = useRef(false);
  useEffect(() => { isStartedRef.current = isStarted; }, [isStarted]);
  const isFinishedRef = useRef(false);
  useEffect(() => { isFinishedRef.current = isFinished; }, [isFinished]);

  // ── fullscreen state ──
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFullscreenGate, setShowFullscreenGate] = useState(false);

  // ── question state ──
  const [allQuestions, setAllQuestions] = useState<any[]>([]);
  const [totalQuestions, setTotalQuestions] = useState(20);
  const [currentQuestionNumber, setCurrentQuestionNumber] = useState(1);
  const [currentQuestion, setCurrentQuestion] = useState<{
    id: number;
    question: string;
    difficulty: string;
    options?: string[];
    answer_text?: string | null;
    question_type?: string;
  } | null>(null);
  const [completedQuestions, setCompletedQuestions] = useState<number[]>([]);
  const [incorrectQuestions, setIncorrectQuestions] = useState<number[]>([]);
  const [visitedQuestions, setVisitedQuestions] = useState<number[]>([]);
  const skippedQuestions = React.useMemo(() => {
    return visitedQuestions.filter(qNum => 
      !completedQuestions.includes(qNum) && qNum !== currentQuestionNumber
    );
  }, [visitedQuestions, completedQuestions, currentQuestionNumber]);

  // Automatically track visited questions as they are viewed or when currentQuestionNumber updates
  useEffect(() => {
    if (currentQuestionNumber) {
      setVisitedQuestions(prev => {
        const nextVisited = new Set([...prev]);
        for (let i = 1; i <= currentQuestionNumber; i++) {
          nextVisited.add(i);
        }
        return Array.from(nextVisited);
      });
    }
  }, [currentQuestionNumber]);
  const [latestFeedback, setLatestFeedback] = useState<{ score: number; text: string } | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const addMsg = (m: string) => setMessages(prev => [...prev, m]);

  // ── proctoring ──
  const [isFaceDetected, setIsFaceDetected] = useState(true);
  const [isFocusingOnMonitor, setIsFocusingOnMonitor] = useState(true);
  const detectorRef = useRef<any>(null);
  const detectorLoadAttemptRef = useRef(0);
  const detectorLoadingRef = useRef(false);
  const faceCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const sessionVideoRef = useRef<HTMLVideoElement>(null);  // pre-start preview
  const floatingVideoRef = useRef<HTMLVideoElement>(null); // in-session floating widget

  // ── audio ──
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const transcriptionCallbackRef = useRef<((text: string) => void) | null>(null);

  // ── video recording ──
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const isSubmittingRef = useRef(false);
  const startSessionVideoRecordingRef = useRef<((stream: MediaStream) => void) | null>(null);

  const faceHistoryRef = useRef<{noseX: number, noseY: number, eyeToEye: number, brightness: number, timestamp: number}[]>([]);
  const initialFaceFeaturesRef = useRef<{ eyeToEye: number, noseToEye: number, eyeNoseRatio: number } | null>(null);
  const gazeDeviationStartRef = useRef<number | null>(null);
  const lastBrowserIntegrityCheckRef = useRef<number>(0);
  const lastPhoneCheckRef = useRef<number>(0);
  const lastBlinkRef = useRef<number>(0);
  const voiceCoachingDurationRef = useRef<number>(0);
  const lastVoiceCoachingLogRef = useRef<number>(0);
  const isListeningRef = useRef(false);
  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);
  const objectDetectorRef = useRef<any>(null);

  // ── heartbeat tracking (tamper-resistance) ──
  const heartbeatSeqRef = useRef<number>(0);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // ── completion/feedback state ──
  const [showAllDoneModal, setShowAllDoneModal] = useState(false);
  const [showFeedbackPanel, setShowFeedbackPanel] = useState(false);
  const [showIssueDialog, setShowIssueDialog] = useState(false);
  const [finalScores, setFinalScores] = useState<Array<{question_number: number; question_type: string; score: number | null}>>([]);

  // ─── SECURITY VIOLATION ────────────────────────────────────────────────────
  const terminationSentRef = useRef(false);

  const postMonitoringEvent = useCallback((
    eventType: string,
    confidenceScore: number,
    video: HTMLVideoElement | null,
    details?: string,
    sequenceNumber?: number,
  ): Promise<any> => {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - sessionStartRef.current) / 1000));
    const videoRefStr = `offset_${elapsedSeconds}s`;

    const clientTimestamp = Date.now();
    const nonce = Math.random().toString(36).substring(2) + Date.now().toString(36);
    const secret = (typeof window !== 'undefined' ? sessionStorage.getItem('proctoring_secret') : null) || "rims_proctoring_secret_2026";
    const tokenStr = token || "";
    const raw_str = `${eventType}:${clientTimestamp}:${nonce}:${tokenStr}:${secret}`;

    return computeHMAC(raw_str, secret).then((signature) => {
      return fetch(`${getApiBaseUrl()}/api/interviews/${interviewId}/monitoring-events`, {
        method: 'POST',
        headers: {
          ...authHeaders(token),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          event_type: eventType,
          confidence_score: confidenceScore,
          frame_snapshot: captureFrame(video),
          details: details,
          video_reference: videoRefStr,
          signature: signature,
          client_timestamp: clientTimestamp,
          nonce: nonce,
          sequence_number: sequenceNumber,
        }),
      })
        .then(async (res) => {
          if (!res.ok) return null;
          const data = await res.json().catch(() => null);
          if (data && typeof data.strike_count === 'number') {
            // Sync authoritative server strike count to local state
            setFocusStrikes((prev) => {
              const serverCount = data.strike_count as number;
              if (serverCount !== prev) {
                if (typeof window !== 'undefined') {
                  sessionStorage.setItem(`strikes_${interviewId}`, serverCount.toString());
                }
              }
              return serverCount;
            });
            // If the server revoked the token, force termination on the client
            if (data.token_revoked === true && !terminationSentRef.current) {
              terminationSentRef.current = true;
              setIsTerminated(true);
            }
          }
          return data;
        })
        .catch(() => null);
    });
  }, [interviewId, token]);

  const handleStrike = useCallback((reason: string, options?: { respectStartupGrace?: boolean }) => {
    if (!isStartedRef.current) return; // use ref — stable, no re-render dependency
    if (options?.respectStartupGrace !== false && Date.now() - sessionStartRef.current < 15000) return; // ignore first 15s
    if (Date.now() - lastStrikeTimeRef.current < 2000) {
      console.log('[Proctoring] Strike ignored due to 2s cooldown');
      return;
    }
    lastStrikeTimeRef.current = Date.now();

    setFocusStrikes(prev => {
      const next = prev + 1;
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(`strikes_${interviewId}`, next.toString());
      }

      // Record strike as a monitoring event to create a server-side audit trail
      const sanitizedReason = reason.replace(/\s+/g, '_').toLowerCase();
      const eventType = `focus_lost_strike_${next}_${sanitizedReason}`;
      postMonitoringEvent(eventType, 0.0, floatingVideoRef.current, JSON.stringify({ strikeNumber: next, reason }));

      if (next < 4) {
        toast.error(`Warning ${next}/3: ${reason}`, {
          description: 'Multiple violations will result in immediate session termination.',
          duration: 5000,
        });
      } else {
        if (!terminationSentRef.current) {
          terminationSentRef.current = true;
          setIsTerminated(true);
          fetch(`${getApiBaseUrl()}/api/interviews/${interviewId}/security-violation`, {
            method: 'POST',
            headers: authHeaders(token),
            body: JSON.stringify({ reason }),
          }).catch(console.error);
        }
      }
      return next;
    });
  }, [interviewId, token, postMonitoringEvent]); // NO isStarted dependency — uses isStartedRef instead

  // ─── VIDEO UPLOAD ──────────────────────────────────────────────────────────
  const uploadVideo = useCallback(async (blob: Blob) => {
    if (blob.size < 1000) return;
    if (isFinishedRef.current) {
      console.log('Skipping video upload because the interview is already completed.');
      return;
    }
    try {
      const formData = new FormData();
      formData.append('file', blob, 'interview_session.webm');
      await APIClient.postMultipart(`/api/interviews/${interviewId}/upload-video`, formData, `v-${Date.now()}`);
    } catch (err: any) {
      // If the interview is already completed, this error is expected and can be silently ignored.
      if (err?.message?.includes('already been completed') || err?.message?.includes('403') || err?.message?.includes('Forbidden')) {
        console.log('Video upload completed or skipped (interview already finished).');
        return;
      }
      console.error('Video upload failed:', err);
    }
  }, [interviewId]);

  // Recovery: check for crashed recording chunks on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && interviewId) {
      loadChunksFromIndexedDB(interviewId).then((savedChunks) => {
        if (savedChunks && savedChunks.length > 0) {
          console.log('[Resilience] Found recovered video chunks from a previous session crash. Uploading...');
          const mimeType = savedChunks[0].type || 'video/webm';
          const blob = new Blob(savedChunks, { type: mimeType });
          uploadVideo(blob).then(() => {
            clearChunksFromIndexedDB(interviewId);
          }).catch(err => console.warn('Failed to upload recovered chunks:', err));
        }
      });
    }
  }, [interviewId, uploadVideo]);

  // ─── LOAD QUESTIONS (poll until ready) ────────────────────────────────────
  const loadCurrentQuestion = useCallback(async (questionNumber?: number) => {
    try {
      if (questionNumber !== undefined) {
        // Jump to specific question
        const all: any[] = await apiFetch(`/api/interviews/${interviewId}/questions`, token);
        const q = all.find((x: any) => x.question_number === questionNumber);
        if (q) {
          setCurrentQuestion({
            id: q.id,
            question: q.question_text,
            difficulty: 'medium',
            options: q.options ? JSON.parse(q.options) : (q.question_options ? JSON.parse(q.question_options) : undefined),
            answer_text: q.answer_text,
            question_type: q.question_type,
          });
          setCurrentQuestionNumber(q.question_number);
          const answered = all.filter((x: any) => x.is_answered).map((x: any) => x.question_number);
          const incorrect = all.filter((x: any) => x.is_answered && x.answer_score !== null && x.answer_score < 5).map((x: any) => x.question_number);
          setCompletedQuestions(answered);
          setIncorrectQuestions(incorrect);
          setTotalQuestions(all.length);
          setAllQuestions(all);
        }
      } else {
        // Get current unanswered question
        const res = await apiFetch(`/api/interviews/${interviewId}/current-question`, token);
        if (res.status === 'processing' || !res.id) return;
        setCurrentQuestion({
          id: res.id,
          question: res.question_text,
          difficulty: 'medium',
          options: res.options ? JSON.parse(res.options) : (res.question_options ? JSON.parse(res.question_options) : undefined),
          answer_text: null,
          question_type: res.question_type,
        });
        setCurrentQuestionNumber(res.question_number);
      }
    } catch (err: any) {
      // 410 = interview complete. Show the All Done modal, not a broken screen.
      if (err.message?.includes('410') || err.message?.toLowerCase().includes('complet') || err.message?.includes('404') || err.message?.includes('not found')) {
        setShowAllDoneModal(true);
      }
      // For all other errors, rethrow so the caller's .catch() can handle it
      else { throw err; }
    }
  }, [interviewId, token]);

  // Handle video recording stop and upload when finished
  useEffect(() => {
    if (isFinished && videoRecorderRef.current && videoRecorderRef.current.state !== 'inactive') {
      videoRecorderRef.current.stop();
    }
  }, [isFinished]);

  // Initial poll: wait for questions to be ready
  useEffect(() => {
    let cancelled = false;
    let pollCount = 0;
    const maxPolls = 60; // 60 * 2.5s = 150 seconds (2.5 minutes)

    const poll = async () => {
      if (cancelled) return;
      try {
        const stage = await apiFetch(`/api/interviews/${interviewId}/stage`, token);
        if (stage.status === 'processing' || !stage.questions_ready) {
          pollCount += 1;
          if (pollCount >= maxPolls) {
            setPollingError("We're experiencing delays preparing your interview questions. Please try again or contact support.");
            setIsLoading(false);
            return;
          }
          if (!cancelled) setTimeout(poll, 2500);
          return;
        }
        if (stage.status === 'completed' || stage.interview_stage === 'completed') {
          setIsFinished(true);
          setIsLoading(false);
          return;
        }
        // Load all questions to populate sidebar
        const all: any[] = await apiFetch(`/api/interviews/${interviewId}/questions`, token);
        if (!cancelled) {
          setTotalQuestions(all.length || stage.total_questions || 20);
          const answered = all.filter((x: any) => x.is_answered).map((x: any) => x.question_number);
          const incorrect = all.filter((x: any) => x.is_answered && x.answer_score !== null && x.answer_score < 5).map((x: any) => x.question_number);
          setCompletedQuestions(answered);
          setIncorrectQuestions(incorrect);
          setAllQuestions(all);
          await loadCurrentQuestion();
          setIsReady(true);
          setIsLoading(false);
        }
      } catch (e: any) {
        const errorMsg = e.message || '';
        const isPermanentError = 
          errorMsg.includes('credentials') || 
          errorMsg.includes('required') || 
          errorMsg.includes('not found') || 
          errorMsg.includes('completed') || 
          errorMsg.includes('terminated') || 
          errorMsg.includes('no longer active') || 
          errorMsg.includes('expired') ||
          errorMsg.includes('mismatch');

        if (isPermanentError) {
          setPollingError(errorMsg);
          setIsLoading(false);
          return;
        }

        pollCount += 1;
        if (pollCount >= maxPolls) {
          setPollingError("An error occurred while connecting to the interview server. Please check your connection and retry.");
          setIsLoading(false);
          return;
        }
        if (!cancelled) setTimeout(poll, 3000);
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [interviewId, token, loadCurrentQuestion, pollTrigger]);

  const handleRetryPoll = () => {
    setPollingError(null);
    setIsLoading(true);
    setPollTrigger(prev => prev + 1);
  };

  // ─── SUBMIT ANSWER ─────────────────────────────────────────────────────────
  const handleSubmitAnswer = async (text: string) => {
    if (!text.trim() || !currentQuestion) return;
    if (isSubmittingRef.current) {
      console.warn('Submission already in progress, ignoring duplicate submit.');
      return;
    }
    isSubmittingRef.current = true;
    setIsEvaluating(true);
    setLatestFeedback(null);
    addMsg('Analyzing your response...');
    try {
      const res = await apiFetch(`/api/interviews/${interviewId}/submit-answer`, token, {
        method: 'POST',
        body: JSON.stringify({ question_id: currentQuestion.id, answer_text: text }),
      });

      if (res.terminated) {
        setIsTerminated(true);
        return;
      }

      const newlyCompleted = [...new Set([...completedQuestions, currentQuestionNumber])];
      setCompletedQuestions(newlyCompleted);
      addMsg('Response recorded. Loading next question...');

      // Small visual delay so the question turns green in the UI before transitioning
      await new Promise(resolve => setTimeout(resolve, 1000));

      const aptitudeQuestions = allQuestions.filter(q => q.question_type === 'aptitude');
      const allAptitudeCompleted = aptitudeQuestions.length > 0 && aptitudeQuestions.every(q => newlyCompleted.includes(q.question_number));

      if (allAptitudeCompleted && currentQuestion.question_type === 'aptitude') {
        // Complete the aptitude round
        await apiFetch(`/api/interviews/${interviewId}/complete-aptitude`, token, { method: 'POST' }).catch(() => null);
        
        // Refresh question list to get the new technical questions
        const updatedQuestions: any[] = await apiFetch(`/api/interviews/${interviewId}/questions`, token);
        setAllQuestions(updatedQuestions);
        setTotalQuestions(updatedQuestions.length);
        
        const firstTech = updatedQuestions.find(q => q.question_type !== 'aptitude');
        if (firstTech) {
           await loadCurrentQuestion(firstTech.question_number);
        } else {
           // All done — show completion modal instead of instantly navigating away
           const scores = updatedQuestions.map(q => ({ question_number: q.question_number, question_type: q.question_type || 'general', score: q.answer_score ?? null }));
           setFinalScores(scores);
           setShowAllDoneModal(true);
        }
      } else {
        // Check if ALL questions across all types are now completed
        const allDone = allQuestions.length > 0 && allQuestions.every(q => newlyCompleted.includes(q.question_number));
        if (allDone) {
          // Fetch latest scores then show completion modal
          try {
            const freshAll: any[] = await apiFetch(`/api/interviews/${interviewId}/questions`, token);
            setAllQuestions(freshAll);
            const scores = freshAll.map(q => ({ question_number: q.question_number, question_type: q.question_type || 'general', score: q.answer_score ?? null }));
            setFinalScores(scores);
          } catch { /* use existing data */ }
          setShowAllDoneModal(true);
        } else {
          // Advance to next question; if none exists (404/410), show completion modal
          const nextNum = currentQuestionNumber + 1;
          try {
            await loadCurrentQuestion(nextNum);
            // If loadCurrentQuestion resolved but question wasn't set, show modal
          } catch {
            setShowAllDoneModal(true);
          }
        }
      }

      // Background: poll for score after short delay
      setTimeout(async () => {
        try {
          const all: any[] = await apiFetch(`/api/interviews/${interviewId}/questions`, token);
          const answered = all.find((q: any) => q.question_number === currentQuestionNumber);
          if (answered?.answer_score !== null && answered?.answer_score !== undefined) {
            setLatestFeedback({ score: answered.answer_score, text: '' });
            if (answered.answer_score < 5) {
              setIncorrectQuestions(prev => [...new Set([...prev, currentQuestionNumber])]);
            }
          }
          setAllQuestions(all);
        } catch { /* ignore */ }
      }, 4000);

    } catch (err: any) {
      // 403 = proctoring enforcement; 410 = session done
      if (err.message?.includes('410') || err.message?.toLowerCase().includes('complet')) {
        setShowAllDoneModal(true);
      } else if (err.message?.includes('403') && err.message?.toLowerCase().includes('proctoring')) {
        toast.error('Proctoring system issue detected. Please ensure your face is visible in the camera.', { duration: 6000 });
      } else {
        toast.error('Failed to submit answer. Please try again.');
      }
    } finally {
      setIsEvaluating(false);
      isSubmittingRef.current = false;
    }
  };

  // ─── FINALISE SESSION (from all-done modal) ───────────────────────────────
  const handleFinalSubmit = async () => {
    setShowAllDoneModal(false);
    try {
      await apiFetch(`/api/interviews/${interviewId}/end`, token, {
        method: 'POST',
        body: JSON.stringify({ force: true, ended_early: false }),
      });
    } catch { /* ignore — show completion screen regardless */ }
    setIsFinished(true);
    setShowFeedbackPanel(true);
  };

  // ─── END SESSION (early) ──────────────────────────────────────────────────
  const handleEndSession = async () => {
    const confirmed = window.confirm("Are you sure you want to end this interview session? Your progress will be saved, but you won't be able to return to it.");
    if (!confirmed) return;

    try {
      await apiFetch(`/api/interviews/${interviewId}/end`, token, {
        method: 'POST',
        body: JSON.stringify({ force: true, ended_early: true }),
      });
    } catch (err: any) {
      console.error('Failed to end interview session backend call:', err);
    }
    setIsFinished(true);
    setShowFeedbackPanel(true);
  };

  const isQuestionLocked = useCallback((qNum: number) => {
    const targetQ = allQuestions.find(q => q.question_number === qNum);
    if (!targetQ) return true;
    
    // Group all questions by type
    const groups: Record<string, any[]> = {};
    allQuestions.forEach((q) => {
      const type = (q.question_type || 'General').toLowerCase();
      if (!groups[type]) groups[type] = [];
      groups[type].push(q);
    });
    
    const orderedTypes = ['aptitude', 'technical', 'behavioral'];
    const otherTypes = Object.keys(groups).filter(t => !orderedTypes.includes(t));
    const displayOrder = [...orderedTypes, ...otherTypes];
    
    const targetType = (targetQ.question_type || 'General').toLowerCase();
    const targetTypeIdx = displayOrder.indexOf(targetType);
    
    // Check if any previous type has incomplete questions
    for (let i = 0; i < targetTypeIdx; i++) {
      const prevType = displayOrder[i];
      const prevGroup = groups[prevType];
      if (prevGroup && prevGroup.length > 0) {
        const hasIncomplete = prevGroup.some(q => !completedQuestions.includes(q.question_number));
        if (hasIncomplete) {
          return true;
        }
      }
    }
    return false;
  }, [allQuestions, completedQuestions]);

  // ─── NAVIGATION ───────────────────────────────────────────────────────────
  const jumpToQuestion = useCallback(async (num: number) => {
    if (!allQuestions.find(q => q.question_number === num)) return;
    if (isEvaluating) { toast.warning('Please wait for evaluation to complete.'); return; }
    if (isQuestionLocked(num)) {
      toast.warning('Please complete all questions in the current section first.');
      return;
    }
    setIsQuestionSwapping(true);
    await loadCurrentQuestion(num);
    setIsQuestionSwapping(false);
  }, [totalQuestions, isEvaluating, loadCurrentQuestion, allQuestions, isQuestionLocked]);

  const handleNext = () => {
    const nextQ = [...allQuestions].sort((a,b) => a.question_number - b.question_number).find(q => q.question_number > currentQuestionNumber);
    if (nextQ) {
      if (isQuestionLocked(nextQ.question_number)) {
        toast.warning('Please complete all questions in the current section first.');
        return;
      }
      jumpToQuestion(nextQ.question_number);
    }
  };
  const handlePrev = () => {
    const prevQ = [...allQuestions].sort((a,b) => b.question_number - a.question_number).find(q => q.question_number < currentQuestionNumber);
    if (prevQ) {
      if (isQuestionLocked(prevQ.question_number)) {
        toast.warning('Please complete all questions in the current section first.');
        return;
      }
      jumpToQuestion(prevQ.question_number);
    }
  };

  // ─── TRANSCRIPTION ─────────────────────────────────────────────────────────
  const startRecording = (callback?: (text: string) => void) => {
    if (callback) transcriptionCallbackRef.current = callback;
    setIsListening(true);
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
      let selectedType = '';
      for (const t of types) { if (MediaRecorder.isTypeSupported(t)) { selectedType = t; break; } }
      const recorder = new MediaRecorder(stream, selectedType ? { mimeType: selectedType } : undefined);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: selectedType || 'audio/webm' });
        // Stop the stream tracks instantly so the browser mic indicator turns off immediately, preventing device locking
        stream.getTracks().forEach(t => t.stop());
        
        if (blob.size > 500) {
          setIsTranscribing(true);
          try {
            const formData = new FormData();
            formData.append('file', blob, 'recording.webm');
            const res = await APIClient.postMultipart<{ text: string }>(`/api/interviews/${interviewId}/transcribe`, formData, `tr-${Date.now()}`, 15000);
            if (res.text) {
              if (transcriptionCallbackRef.current) transcriptionCallbackRef.current(res.text);
            } else {
              toast.error("Transcription returned empty. Please speak clearly or check your mic.");
            }
          } catch (e: any) {
             console.error('Transcription failed', e);
             const errorMsg = e.message || String(e);
             const isTerminatedError = errorMsg.toLowerCase().includes('terminated') || 
                                     errorMsg.toLowerCase().includes('proctoring violation');
             
             if (isTerminatedError) {
               toast.error('Voice service is unavailable as the session has been terminated.');
               setIsTerminated(true);
             } else {
               toast.error('Voice transcription failed. You can type your response.');
             }
          } finally { setIsTranscribing(false); }
        } else if (blob.size > 0) {
          toast.error("Audio recording was too short or silent. Please try again.");
        }
      };
      recorder.start();
      setIsListening(true);
    }).catch(err => {
      console.error('Microphone access error:', err);
      toast.error('Microphone access denied or unavailable.');
    });
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isListening) {
      mediaRecorderRef.current.stop();
      setIsListening(false);
    }
  };

  // ─── PROCTORING SETUP ──────────────────────────────────────────────────────
  const cameraInitializedRef = useRef(false);
  const deviceChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const initCameraRef = useRef<(() => Promise<void>) | null>(null);

  // Handle device reconnection with debouncing and exponential backoff retry
  const handleDeviceChange = useCallback(async () => {
    // Clear any pending debounce timeout
    if (deviceChangeTimeoutRef.current) {
      clearTimeout(deviceChangeTimeoutRef.current);
    }

    // Debounce: wait 1000ms before attempting reconnection
    deviceChangeTimeoutRef.current = setTimeout(async () => {
      // Check if the camera is currently offline/disconnected.
      // This is true if cameraInitializedRef is false, or if there's no active stream,
      // or if the current video track has ended or is missing.
      const videoTrack = activeStreamRef.current?.getVideoTracks()[0];
      const isVideoEnded = !videoTrack || videoTrack.readyState === 'ended';
      const isCameraOffline = !cameraInitializedRef.current || isVideoEnded;

      // Only attempt reconnection if camera is offline and interview is not finished
      if (isCameraOffline && !isFinishedRef.current) {
        let attempts = 0;
        const maxAttempts = 3;
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

        while (attempts < maxAttempts && !isFinishedRef.current) {
          // Recheck connection state inside the loop
          const currentVideoTrack = activeStreamRef.current?.getVideoTracks()[0];
          const currentVideoEnded = !currentVideoTrack || currentVideoTrack.readyState === 'ended';
          const currentlyOffline = !cameraInitializedRef.current || currentVideoEnded;

          if (!currentlyOffline) {
            break;
          }

          attempts++;
          try {
            // Enumerate devices to confirm video input is available
            const devices = await navigator.mediaDevices.enumerateDevices();
            const hasVideoInput = devices.some(device => device.kind === 'videoinput');
            
            if (hasVideoInput) {
              console.log(`[Camera] Video device detected (attempt ${attempts}/${maxAttempts}), attempting reinitialization...`);
              // Call initCamera to reinitialize the stream
              if (initCameraRef.current) {
                await initCameraRef.current();
              }
              
              const postVideoTrack = activeStreamRef.current?.getVideoTracks()[0];
              const postVideoEnded = !postVideoTrack || postVideoTrack.readyState === 'ended';
              const postOffline = !cameraInitializedRef.current || postVideoEnded;
              
              if (!postOffline) {
                console.log('[Camera] Reconnection successful!');
                break;
              }
            }
          } catch (err) {
            console.error(`[Camera] Reconnection attempt ${attempts} failed:`, err);
          }

          const finalVideoTrack = activeStreamRef.current?.getVideoTracks()[0];
          const finalVideoEnded = !finalVideoTrack || finalVideoTrack.readyState === 'ended';
          const finalOffline = !cameraInitializedRef.current || finalVideoEnded;

          if (finalOffline && attempts < maxAttempts && !isFinishedRef.current) {
            console.log(`[Camera] Waiting before retry attempt ${attempts + 1}...`);
            await delay(1000 * attempts); // 1s, 2s backoff
          }
        }
      }
    }, 1000);
  }, []);

  useEffect(() => {
    async function initCamera() {
      // Check if we can reuse the existing audio track to prevent audio interruption
      const existingAudioTrack = activeStreamRef.current?.getAudioTracks()[0];
      const isAudioLive = existingAudioTrack && existingAudioTrack.readyState === 'live';
      
      let stream: MediaStream;
      
      try {
        try {
          if (!detectorRef.current) {
            detectorRef.current = await loadFaceDetector();
          }
          if (!objectDetectorRef.current) {
            const cocoSsd = await import('@tensorflow-models/coco-ssd');
            objectDetectorRef.current = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
            console.info('[Proctoring] COCO-SSD object detector loaded.');
          }
        } catch (modelErr) {
          console.warn(
            '[FaceCheck] Models failed to load during device check; continuing with fallback checks.',
            modelErr instanceof Error ? modelErr.message : modelErr
          );
        }

        if (isAudioLive && activeStreamRef.current) {
          console.log('[Camera] Audio track is live, only requesting video to prevent device lock/interruptions.');
          // Stop only the old video track
          const oldVideoTrack = activeStreamRef.current.getVideoTracks()[0];
          if (oldVideoTrack) {
            try { oldVideoTrack.stop(); } catch (e) { console.warn(e); }
          }
          
          // Request ONLY video
          const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
          const newVideoTrack = videoStream.getVideoTracks()[0];
          
          if (oldVideoTrack) {
            try { activeStreamRef.current.removeTrack(oldVideoTrack); } catch (e) { console.warn(e); }
          }
          activeStreamRef.current.addTrack(newVideoTrack);
          stream = activeStreamRef.current;
        } else {
          console.log('[Camera] Requesting both audio and video streams.');
          // Clean up everything first
          activeStreamRef.current?.getTracks().forEach(track => track.stop());
          activeStreamRef.current = null;
          
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          activeStreamRef.current = stream;
        }
        
        // Scan for virtual camera inputs
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const virtualCams = devices.filter(d => 
            d.kind === 'videoinput' && 
            (d.label.toLowerCase().includes('obs') || 
             d.label.toLowerCase().includes('manycam') || 
             d.label.toLowerCase().includes('virtual') || 
             d.label.toLowerCase().includes('synthetic') ||
             d.label.toLowerCase().includes('device-identification'))
          );
          if (virtualCams.length > 0) {
            console.warn('[Proctoring] Virtual camera detected:', virtualCams.map(c => c.label));
            postMonitoringEvent('liveness_violation', 1.0, null, JSON.stringify({
              category: 'virtual_camera_detected',
              devices: virtualCams.map(c => c.label)
            }));
          }
        } catch (e) {
          console.warn('Failed to enumerate devices:', e);
        }

        // Ensure stream is bound to all relevant video elements
        if (sessionVideoRef.current) {
          sessionVideoRef.current.srcObject = stream;
          sessionVideoRef.current.play().catch(e => console.warn("Preview video play error:", e));
        }
        if (floatingVideoRef.current) {
          floatingVideoRef.current.srcObject = stream;
          floatingVideoRef.current.play().catch(e => console.warn("Floating video play error:", e));
        }

        cameraInitializedRef.current = true;
        setIsCameraConnected(true);
        setIsDeviceTestSuccess(true);
        setDeviceTestError(null);

        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.onmute = () => handleStrike('Camera feed disabled/muted');
          videoTrack.onended = () => {
            cameraInitializedRef.current = false;
            setIsCameraConnected(false);
            handleStrike('Camera hardware disconnected');
          };

          // ─── VIRTUAL CAMERA DETECTION VIA TRACK CAPABILITIES ───
          try {
            const caps: any = typeof videoTrack.getCapabilities === 'function' ? videoTrack.getCapabilities() : {};
            const settings: any = typeof videoTrack.getSettings === 'function' ? videoTrack.getSettings() : {};
            
            const hasStaticFps = caps.frameRate && (caps.frameRate.max === 0 || (caps.frameRate.min === caps.frameRate.max && caps.frameRate.max <= 5));
            const isLowFps = settings.frameRate && settings.frameRate <= 5;
            const isEmulated = caps.facingMode === undefined && caps.deviceId === undefined;
            
            if (hasStaticFps || isLowFps || isEmulated) {
              console.warn('[Proctoring] Virtual camera track capabilities match:', { caps, settings });
              postMonitoringEvent('liveness_violation', 1.0, null, JSON.stringify({
                category: 'virtual_camera_detected',
                details: 'Static framerate, missing standard device capabilities, or emulation signature detected.',
                frameRateMax: caps.frameRate?.max,
                frameRateMin: caps.frameRate?.min,
                currentFrameRate: settings.frameRate,
                facingMode: caps.facingMode
              }));
            }
          } catch (capErr) {
            console.warn('[Proctoring] Failed to audit track capabilities:', capErr);
          }
        }

        // Only set up audio track handlers if we requested a new audio track
        if (!isAudioLive) {
          const audioTrack = stream.getAudioTracks()[0];
          if (audioTrack) {
            audioTrack.onmute = () => handleStrike('Microphone feed disabled/muted');
            audioTrack.onended = () => {
              handleStrike('Microphone hardware disconnected');
            };
            
            try {
              const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
              if (AudioContext) {
                const audioCtx = new AudioContext();
                const analyser = audioCtx.createAnalyser();
                const source = audioCtx.createMediaStreamSource(stream);
                source.connect(analyser);
                analyser.fftSize = 256;
                const dataArray = new Uint8Array(analyser.frequencyBinCount);
                
                const updateVolume = () => {
                  if (cameraInitializedRef.current === false) return; // stopped
                  analyser.getByteFrequencyData(dataArray);
                  let sum = 0;
                  for(let i=0; i<dataArray.length; i++) sum += dataArray[i];
                  const avg = sum / dataArray.length;
                  const volBar = document.getElementById('mic-volume-bar');
                  if (volBar) {
                    volBar.style.width = Math.min(100, (avg / 64) * 100) + '%';
                  }

                  // Voice Activity Detection (VAD) Speech-band extraction (bins 1 to 16)
                  let speechSum = 0;
                  let noiseSum = 0;
                  const speechBins = 16;
                  for (let i = 1; i <= speechBins && i < dataArray.length; i++) {
                    speechSum += dataArray[i];
                  }
                  for (let i = speechBins + 1; i < dataArray.length; i++) {
                    noiseSum += dataArray[i];
                  }
                  const avgSpeech = speechSum / speechBins;
                  const avgNoise = noiseSum / Math.max(1, dataArray.length - speechBins - 1);
                  const isSpeechDetected = avgSpeech > 25 && avgSpeech > avgNoise * 2.0;

                  // Voice coaching / Speaker detection (audit-only)
                  if (isSpeechDetected && !isListeningRef.current) {
                    voiceCoachingDurationRef.current += 16.7;
                    if (voiceCoachingDurationRef.current > 3000) {
                      const now = Date.now();
                      if (now - lastVoiceCoachingLogRef.current > 10000) {
                        lastVoiceCoachingLogRef.current = now;
                        postMonitoringEvent('voice_coaching_detected', 0.8, null, JSON.stringify({
                          category: 'audio_energy_anomaly',
                          averageVolume: avgSpeech,
                          durationSeconds: 3
                        }));
                      }
                      voiceCoachingDurationRef.current = 0;
                    }
                  } else {
                    voiceCoachingDurationRef.current = Math.max(0, voiceCoachingDurationRef.current - 50);
                  }

                  requestAnimationFrame(updateVolume);
                };
                updateVolume();
              }
            } catch(e) {
              console.error('AudioContext setup failed', e);
            }
          }
        }

        // Restart video recorder if the interview is already started
        if (isStartedRef.current && startSessionVideoRecordingRef.current) {
          console.log('[Camera] Restarting MediaRecorder with reconnected stream...');
          startSessionVideoRecordingRef.current(stream);
        }

      } catch (e: any) {
        console.error('Video setup failed', e);
        setIsCameraConnected(false);
        setIsDeviceTestSuccess(false);
        setDeviceTestError(e.message || String(e));
      }
    }
    
    // Store initCamera in ref so handleDeviceChange can call it
    initCameraRef.current = initCamera;
    
    initCamera();
    
    // Register devicechange event listener to detect camera reconnection
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);

    // ── cleanup only runs on true component unmount, NOT on re-renders ──
    const mountedStream = { ref: activeStreamRef };
    return () => {
      // Remove devicechange event listener
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
      
      // Only stop tracks when the whole component unmounts (user leaves interview)
      if (mountedStream.ref.current) {
        mountedStream.ref.current.getTracks().forEach(t => t.stop());
        console.log('[Camera] Stopped all tracks on component unmount.');
      }
    };
  }, [handleStrike, handleDeviceChange]); // handleStrike is now stable — doesn't change on isStarted

  // Synchronize camera stream to pre-start preview when loading completes
  useEffect(() => {
    if (!isStarted && sessionVideoRef.current && activeStreamRef.current) {
      if (sessionVideoRef.current.srcObject !== activeStreamRef.current) {
        sessionVideoRef.current.srcObject = activeStreamRef.current;
        console.log("[Preview] Bound camera stream to pre-start preview.");
      }
    }
  }, [isStarted, isLoading]);

  // Synchronize camera stream to floating widget when interview starts
  useEffect(() => {
    if (isStarted && floatingVideoRef.current && activeStreamRef.current) {
      const floatingVideo = floatingVideoRef.current;
      if (floatingVideo.srcObject !== activeStreamRef.current) {
        floatingVideo.srcObject = activeStreamRef.current;
        console.log("[Float] Bound camera stream to floating widget.");
      }
      floatingVideo.play().catch((e) => console.warn("Floating video play error:", e));
    }
  }, [isStarted, isCameraConnected]);

  // Fullscreen tracking
  useEffect(() => {
    const onFSChange = () => {
      const isFull = !!document.fullscreenElement;
      setIsFullscreen(isFull);
      // If session is running and user exits fullscreen, record strike and show gate
      if (!isFull && isStartedRef.current) {
        console.log('[Proctoring] Fullscreen exit detected');
        handleStrike('Exited fullscreen mode');
        setShowFullscreenGate(true);
      }
    };
    document.addEventListener('fullscreenchange', onFSChange);
    return () => document.removeEventListener('fullscreenchange', onFSChange);
  }, [handleStrike]);

  const enterFullscreen = async () => {
    try {
      await document.documentElement.requestFullscreen();
      setIsFullscreen(true);
      setShowFullscreenGate(false);
    } catch (e) {
      console.error('Fullscreen request failed:', e);
    }
  };

  // Double-enforcement check to prevent bypass / direct deep links without device tests
  useEffect(() => {
    if (isStarted) {
      if (!cameraInitializedRef.current || !activeStreamRef.current) {
        console.error("Bypass detected: Interview started without active camera stream.");
        const reason = "Bypassed device hardware verification test directly into live session.";
        setTerminationReason(reason);
        setIsTerminated(true);
        
        fetch(`${getApiBaseUrl()}/api/interviews/${interviewId}/fail-device-test`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ reason })
        }).catch(err => console.error("Failed to report device bypass:", err));
      }
    }
  }, [isStarted, interviewId, token]);

  // Remove duplicate postMonitoringEvent
  const handleClipboardViolation = useCallback((type: 'copy' | 'paste' | 'cut') => {
    toast.warning(`Clipboard operation (${type}) is disabled in this assessment.`, {
      description: 'Your attempt has been logged for security review.',
      duration: 5000,
    });
    postMonitoringEvent('clipboard_violation', 1.0, floatingVideoRef.current, JSON.stringify({ action: type }));
  }, [postMonitoringEvent]);

  // Global PrintScreen capture detector
  useEffect(() => {
    if (!isStarted) return;
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'PrintScreen') {
        toast.warning('Screenshot capture attempt detected.', {
          description: 'This event has been logged for security review.',
          duration: 5000,
        });
        postMonitoringEvent('clipboard_violation', 1.0, floatingVideoRef.current, JSON.stringify({ action: 'printscreen_attempt' }));
      }
    };
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isStarted, postMonitoringEvent]);

  const startSessionVideoRecording = useCallback((stream: MediaStream) => {
    // Initialize session video recorder
    if (videoRecorderRef.current && videoRecorderRef.current.state !== 'inactive') {
      try { videoRecorderRef.current.stop(); } catch (e) { console.error(e); }
    }

    let vRecorder: MediaRecorder | null = null;
    let recordingStarted = false;

    // Helper to start MediaRecorder on a stream with a set of mimetypes
    const tryStartRecorder = (mediaStream: MediaStream, mimeTypes: string[]): { recorder: MediaRecorder | null, started: boolean } => {
      let recorderInstance: MediaRecorder | null = null;
      let isStarted = false;
      
      // Try mimetypes in order of preference
      for (const mime of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mime)) {
          try {
            recorderInstance = new MediaRecorder(mediaStream, { mimeType: mime });
            videoChunksRef.current = [];
            recorderInstance.ondataavailable = (e) => { if (e.data.size > 0) videoChunksRef.current.push(e.data); };
            recorderInstance.onstop = () => {
              const blob = new Blob(videoChunksRef.current, { type: mime || 'video/webm' });
              uploadVideo(blob);
            };
            recorderInstance.start(10000);
            isStarted = true;
            console.log(`Successfully started MediaRecorder with mimeType: ${mime}`);
            break;
          } catch (err) {
            console.warn(`Failed to start MediaRecorder with mimeType: ${mime}, trying next...`, err);
            recorderInstance = null;
          }
        }
      }

      // Fallback to default options if preferred mimetypes failed
      if (!isStarted) {
        try {
          recorderInstance = new MediaRecorder(mediaStream);
          videoChunksRef.current = [];
          recorderInstance.ondataavailable = (e) => { if (e.data.size > 0) videoChunksRef.current.push(e.data); };
          recorderInstance.onstop = () => {
            const blob = new Blob(videoChunksRef.current, { type: recorderInstance?.mimeType || 'video/webm' });
            uploadVideo(blob);
          };
          recorderInstance.start(10000);
          isStarted = true;
          console.log("Successfully started MediaRecorder with default settings");
        } catch (err) {
          console.error("Failed to start MediaRecorder with default settings:", err);
          recorderInstance = null;
        }
      }

      return { recorder: recorderInstance, started: isStarted };
    };

    // Step 1: Try recording combined audio and video tracks
    const comboMimeTypes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm',
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4'
    ];
    
    console.log("Attempting combined audio and video session recording...");
    const attempt1 = tryStartRecorder(stream, comboMimeTypes);
    
    if (attempt1.started && attempt1.recorder) {
      vRecorder = attempt1.recorder;
      recordingStarted = true;
    } else {
      // Step 2: Fallback to video-only track recording to bypass hardware/codec/mimetype mismatches
      console.warn("Combined recording failed to start. Falling back to video-only stream...");
      const videoTracks = stream.getVideoTracks();
      if (videoTracks.length > 0) {
        const videoOnlyStream = new MediaStream(videoTracks);
        const videoOnlyMimeTypes = [
          'video/webm;codecs=vp9',
          'video/webm;codecs=vp8',
          'video/webm;codecs=h264',
          'video/webm',
          'video/mp4;codecs=avc1.42E01E',
          'video/mp4'
        ];
        const attempt2 = tryStartRecorder(videoOnlyStream, videoOnlyMimeTypes);
        if (attempt2.started && attempt2.recorder) {
          vRecorder = attempt2.recorder;
          recordingStarted = true;
        }
      }
    }

    if (vRecorder && recordingStarted) {
      videoRecorderRef.current = vRecorder;
    } else {
      console.error("All MediaRecorder attempts failed. Proctoring is active but video recording is offline.");
      toast.error("Video recording could not be started, but your interview session is safe to continue.", {
        description: "Webcam monitoring and proctoring remain fully active."
      });
    }
  }, [uploadVideo]);

  useEffect(() => {
    startSessionVideoRecordingRef.current = startSessionVideoRecording;
  }, [startSessionVideoRecording]);

  // Proctoring monitors & Video recorder (Runs when isStarted becomes true)
  useEffect(() => {
    if (!isStarted || !activeStreamRef.current) return;

    let checkCount = 0;
    const stream = activeStreamRef.current;

    startSessionVideoRecording(stream);

    // ─── HEARTBEAT INTERVAL SETUP (MONOTONIC SEQ) ───
    if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
    heartbeatIntervalRef.current = setInterval(() => {
      if (!isStartedRef.current) return;
      const currentSeq = heartbeatSeqRef.current;
      heartbeatSeqRef.current += 1;
      postMonitoringEvent('normal', 1.0, null, JSON.stringify({ category: 'heartbeat' }), currentSeq);
    }, 5000);

    if (faceCheckIntervalRef.current) clearInterval(faceCheckIntervalRef.current);
    faceCheckIntervalRef.current = setInterval(async () => {
      // Use floatingVideoRef — sessionVideoRef is unmounted once the session starts
      const video = floatingVideoRef.current;
      if (!video) return;
      if (!detectorRef.current) {
        setIsFaceDetected(true);
        if (!detectorLoadingRef.current && Date.now() - detectorLoadAttemptRef.current > 10000) {
          detectorLoadAttemptRef.current = Date.now();
          detectorLoadingRef.current = true;
          loadFaceDetector()
            .then((detector) => {
              detectorRef.current = detector;
              detectorLoadingRef.current = false;
              console.info('[FaceCheck] Face detector loaded successfully.');
              setIsFocusingOnMonitor(true);
            })
            .catch((err) => {
              detectorLoadingRef.current = false;
              console.warn(
                '[FaceCheck] Face detector reload failed; will retry.',
                err instanceof Error ? err.message : err
              );
            });
        }
        setIsFocusingOnMonitor(false);
        checkCount++;
        if (checkCount >= 5) {
          checkCount = 0;
          postMonitoringEvent('face_not_visible', 0, video);
        }
        return;
      }
      if (video.readyState < 2 || video.videoWidth === 0) {
        setIsFaceDetected(false);
        setIsFocusingOnMonitor(false);
        // Ensure stream is still bound to the widget
        if (activeStreamRef.current && video.srcObject !== activeStreamRef.current) {
          video.srcObject = activeStreamRef.current;
          console.log('[FaceCheck] Reattached stream to floating widget.');
        }
        video.play().catch(() => {});
        return;
      }
      
      try {
        // 1. Ambient lighting verification (Audit-only)
        const brightness = getAverageBrightness(video);
        if (brightness < 40) {
          postMonitoringEvent('low_lighting', 0.0, video, JSON.stringify({ brightness }));
        }

        const detectorObj = detectorRef.current;
        let rawPredictions: any[] = [];
        if (detectorObj.type === 'facemesh') {
          rawPredictions = await detectorObj.detector.estimateFaces(video, {
            flipHorizontal: false,
            staticImageMode: false
          });
        } else {
          rawPredictions = await detectorObj.detector.estimateFaces(video, false, true);
        }

        const faceFound = rawPredictions.length > 0;
        setIsFaceDetected(faceFound);

        let mappedPredictions: any[] = [];
        if (faceFound) {
          const pred = rawPredictions[0];
          if (detectorObj.type === 'facemesh') {
            const box = pred.box;
            const keypoints = pred.keypoints;
            
            const rightEye = keypoints[33] || keypoints[0];
            const leftEye = keypoints[263] || keypoints[0];
            const nose = keypoints[4] || keypoints[0];
            const mouth = keypoints[13] || keypoints[0];
            const rightEar = keypoints[234] || keypoints[0];
            const leftEar = keypoints[454] || keypoints[0];

            mappedPredictions.push({
              topLeft: [box.xMin, box.yMin],
              bottomRight: [box.xMax, box.yMax],
              probability: pred.score ?? 1.0,
              landmarks: [
                [rightEye.x, rightEye.y],
                [leftEye.x, leftEye.y],
                [nose.x, nose.y],
                [mouth.x, mouth.y],
                [rightEar.x, rightEar.y],
                [leftEar.x, leftEar.y]
              ]
            });
          } else {
            mappedPredictions.push(pred);
          }
        }

        const predictions = mappedPredictions;
        const faceQuality = predictions.length === 1 ? getFaceQuality(predictions[0], video) : null;
        const faceInFocus = Boolean(faceQuality?.inFocus);
        setIsFocusingOnMonitor(predictions.length === 1 && faceInFocus);

        if (predictions.length === 0) {
          postMonitoringEvent('face_not_detected', 0, video);
          handleStrike('No face detected', { respectStartupGrace: false });
        } else if (rawPredictions.length > 1) {
          postMonitoringEvent('multiple_people', 0, video);
          handleStrike('Multiple people detected', { respectStartupGrace: false });
        } else if (!faceInFocus) {
          postMonitoringEvent('face_not_visible', faceQuality?.confidence ?? 0, video);
          handleStrike('Face not in focus', { respectStartupGrace: false });
        }

        // Advanced Proctoring Heuristics (Audit-only)
        if (predictions.length === 1) {
          const pred = predictions[0];
          if (pred && pred.landmarks) {
            const nose = pred.landmarks[2];
            const leftEye = pred.landmarks[1];
            const rightEye = pred.landmarks[0];
            if (nose && leftEye && rightEye) {
              const noseX = nose[0];
              const noseY = nose[1];
              const leftEyeX = leftEye[0];
              const leftEyeY = leftEye[1];
              const rightEyeX = rightEye[0];
              const rightEyeY = rightEye[1];
              
              const eyeToEye = Math.sqrt(Math.pow(leftEyeX - rightEyeX, 2) + Math.pow(leftEyeY - rightEyeY, 2));
              const eyeMidX = (leftEyeX + rightEyeX) / 2;
              const eyeMidY = (leftEyeY + rightEyeY) / 2;
              const noseToEye = Math.sqrt(Math.pow(noseX - eyeMidX, 2) + Math.pow(noseY - eyeMidY, 2));
              
              // ─── IDENTITY VERIFICATION & DRIFT (Cosine Similarity landmarks embedding) ───
              const landmarks = pred.landmarks.map((l: any) => [l[0], l[1]]);
              const currentEmbedding = computeFaceEmbedding(landmarks);
              
              if (!initialFaceFeaturesRef.current) {
                (initialFaceFeaturesRef as any).current = currentEmbedding;
                console.log('[Proctoring] Reference face embedding registered.');
              } else {
                const refEmbedding = (initialFaceFeaturesRef as any).current;
                const similarity = cosineSimilarity(refEmbedding, currentEmbedding);
                if (similarity < 0.96) {
                  postMonitoringEvent('liveness_violation', 1.0, video, JSON.stringify({
                    category: 'identity_drift',
                    description: 'Candidate replacement detected / face structure shift (Cosine Similarity anomaly)',
                    similarity,
                    threshold: 0.96
                  }));
                }
              }

              // ─── 3D HEAD POSE & GAZE ANOMALY DETECTION (Yaw, Pitch, Roll) ───
              let yaw = 0;
              let pitch = 0;
              let roll = 0;

              if (detectorObj.type === 'facemesh') {
                const kps = rawPredictions[0].keypoints;
                if (kps && kps.length > 362) {
                  const eyeMidXMesh = (kps[133].x + kps[362].x) / 2;
                  const eyeMidYMesh = (kps[133].y + kps[362].y) / 2;
                  const eyeWidth = Math.abs(kps[133].x - kps[362].x) || 1;
                  
                  const noseOffset = kps[4].x - eyeMidXMesh;
                  yaw = (noseOffset / eyeWidth) * 100;
                  
                  const faceHeight = Math.abs(kps[152].y - eyeMidYMesh) || 1;
                  const noseOffsetVer = kps[4].y - eyeMidYMesh;
                  pitch = ((noseOffsetVer / faceHeight) - 0.35) * 120;
                  
                  roll = Math.atan2(kps[362].y - kps[133].y, kps[362].x - kps[133].x) * (180 / Math.PI);
                }
              } else {
                const distLeft = Math.abs(noseX - leftEyeX);
                const distRight = Math.abs(noseX - rightEyeX);
                const total = distLeft + distRight;
                const mouthY = pred.landmarks[3][1];
                
                yaw = Math.asin(Math.max(-1, Math.min(1, (distLeft - distRight) / (total || 1)))) * (180 / Math.PI);
                roll = Math.atan2(rightEyeY - leftEyeY, rightEyeX - leftEyeX) * (180 / Math.PI);
                const verticalRatio = (noseY - eyeMidY) / (mouthY - eyeMidY || 1);
                pitch = (verticalRatio - 0.45) * 90;
              }
              
              let gazeDirection: 'Center' | 'Left' | 'Right' | 'Upward' | 'Downward' = 'Center';
              if (yaw < -25) {
                gazeDirection = 'Left';
              } else if (yaw > 25) {
                gazeDirection = 'Right';
              } else if (pitch < -20) {
                gazeDirection = 'Downward';
              } else if (pitch > 20) {
                gazeDirection = 'Upward';
              }

              if (gazeDirection !== 'Center') {
                if (gazeDeviationStartRef.current === null) {
                  gazeDeviationStartRef.current = Date.now();
                }
                const duration = (Date.now() - gazeDeviationStartRef.current) / 1000;
                postMonitoringEvent('gaze_deviation', 0.0, video, JSON.stringify({
                  direction: gazeDirection,
                  duration,
                  yaw: Math.round(yaw),
                  pitch: Math.round(pitch),
                  roll: Math.round(roll),
                  confidence: faceQuality?.confidence ?? 1.0
                }));
              } else {
                gazeDeviationStartRef.current = null;
              }

              // ─── HISTORY FOR PHOTO ATTACK & FROZEN FRAME ───
              faceHistoryRef.current.push({
                noseX,
                noseY,
                eyeToEye,
                brightness,
                timestamp: Date.now()
              });
              if (faceHistoryRef.current.length > 10) {
                faceHistoryRef.current.shift();
              }

              if (faceHistoryRef.current.length >= 5) {
                const noseXs = faceHistoryRef.current.map(h => h.noseX);
                const noseYs = faceHistoryRef.current.map(h => h.noseY);
                const brightnesses = faceHistoryRef.current.map(h => h.brightness);
                
                const noseXVar = calculateVariance(noseXs);
                const noseYVar = calculateVariance(noseYs);
                const brightnessVar = calculateVariance(brightnesses);
                
                if (noseXVar < 0.005 && noseYVar < 0.005) {
                  postMonitoringEvent('liveness_violation', 1.0, video, JSON.stringify({
                    category: 'static_image_detected',
                    description: 'Zero micro-movements detected over consecutive frames. Likely a static photo/image attack.',
                    noseXVar,
                    noseYVar
                  }));
                }
                
                if (brightnessVar < 0.0001) {
                  postMonitoringEvent('liveness_violation', 1.0, video, JSON.stringify({
                    category: 'frozen_frame_detected',
                    description: 'Camera frame brightness is completely static. Likely frozen frame or feed replication.',
                    brightnessVar
                  }));
                }

                // Blink & Eye Closure / Anti-Spoofing Detection
                let isBlinkDetected = false;
                const nowTime = Date.now();
                if (detectorObj.type === 'facemesh') {
                  const kps = rawPredictions[0].keypoints;
                  if (kps && kps.length > 386) {
                    const dist3D = (kp1: any, kp2: any) => {
                      return Math.sqrt(
                        Math.pow(kp1.x - kp2.x, 2) +
                        Math.pow(kp1.y - kp2.y, 2) +
                        Math.pow((kp1.z ?? 0) - (kp2.z ?? 0), 2)
                      );
                    };
                    const dLeftV = dist3D(kps[159], kps[145]);
                    const dLeftH = dist3D(kps[33], kps[133]);
                    const earLeft = dLeftV / (dLeftH || 1);

                    const dRightV = dist3D(kps[386], kps[374]);
                    const dRightH = dist3D(kps[362], kps[263]);
                    const earRight = dRightV / (dRightH || 1);

                    const currentEAR = (earLeft + earRight) / 2;
                    
                    if (currentEAR < 0.18) {
                      if (nowTime - lastBlinkRef.current > 4000) {
                        lastBlinkRef.current = nowTime;
                        isBlinkDetected = true;
                        postMonitoringEvent('normal', 1.0, null, JSON.stringify({
                          category: 'blink_detected',
                          ear: parseFloat(currentEAR.toFixed(3)),
                          duration: 0.15
                        }));
                      }
                    }
                  }
                }

                if (!isBlinkDetected && detectorObj.type !== 'facemesh') {
                  const eyeDistances = faceHistoryRef.current.map(h => h.eyeToEye);
                  const maxEyeDist = Math.max(...eyeDistances);
                  const minEyeDist = Math.min(...eyeDistances);
                  if (maxEyeDist - minEyeDist > 2) {
                    if (nowTime - lastBlinkRef.current > 4000) {
                      lastBlinkRef.current = nowTime;
                      postMonitoringEvent('normal', 1.0, null, JSON.stringify({
                        category: 'blink_detected',
                        duration: 0.15
                      }));
                    }
                  }
                }

                // Spoofing check: warn if no blink for >20 seconds
                if (nowTime - lastBlinkRef.current > 20000 && nowTime - sessionStartRef.current > 25000) {
                  postMonitoringEvent('liveness_violation', 0.8, video, JSON.stringify({
                    category: 'no_blink_detected',
                    description: 'No blink detected for over 20 seconds. Potential static photo/spoofing attack.'
                  }));
                  lastBlinkRef.current = nowTime - 10000;
                }
              }

              // ─── MOBILE PHONE / TABLET OBJECT DETECTION (COCO-SSD / Fallback) ───
              const now = Date.now();
              if (now - lastPhoneCheckRef.current > 6000) {
                lastPhoneCheckRef.current = now;
                
                let phoneDetected = false;
                if (objectDetectorRef.current) {
                  try {
                    const predictionsObj = await objectDetectorRef.current.detect(video);
                    const phonePrediction = predictionsObj.find((p: any) => 
                      (p.class === 'cell phone' || p.class === 'phone' || p.class === 'mobile phone' || p.class === 'tablet') &&
                      p.score > 0.45
                    );
                    if (phonePrediction) {
                      phoneDetected = true;
                      postMonitoringEvent('liveness_violation', phonePrediction.score, video, JSON.stringify({
                        category: 'mobile_phone_detected',
                        description: `Object detector identified a ${phonePrediction.class} with ${Math.round(phonePrediction.score * 100)}% confidence.`,
                        bbox: phonePrediction.bbox
                      }));
                    }
                  } catch (objErr) {
                    console.warn('Object detection failed:', objErr);
                  }
                }
                
                if (!phoneDetected) {
                  const hasPhone = detectPhoneHeuristic(video, pred.topLeft, pred.bottomRight);
                  if (hasPhone) {
                    postMonitoringEvent('liveness_violation', 1.0, video, JSON.stringify({
                      category: 'mobile_phone_detected',
                      description: 'Candidate matches patterns consistent with phone/tablet usage near face (heuristic fallback).'
                    }));
                  }
                }
              }
            }
          }
        }

        // ─── BROWSER INTEGRITY & DEVTOOLS DETECTION (every 9 seconds) ───
        const timeNow = Date.now();
        if (timeNow - lastBrowserIntegrityCheckRef.current > 9000) {
          lastBrowserIntegrityCheckRef.current = timeNow;
          
          const isWebdriver = navigator.webdriver || 
                              (typeof document !== 'undefined' && document.documentElement.getAttribute('webdriver') !== null) ||
                              '__webdriver_evaluate' in window ||
                              '__selenium_evaluate' in window ||
                              '__puppeteer_evaluate' in window;
                              
          const userAgentLower = navigator.userAgent.toLowerCase();
          const isHeadless = userAgentLower.includes('headless') || 
                             userAgentLower.includes('puppeteer') || 
                             userAgentLower.includes('selenium') || 
                             userAgentLower.includes('playwright');
          
          const widthThreshold = window.outerWidth - window.innerWidth > 160;
          const heightThreshold = window.outerHeight - window.innerHeight > 160;
          const isDevToolsOpen = widthThreshold || heightThreshold;
          
          if (isWebdriver || isHeadless || isDevToolsOpen) {
            postMonitoringEvent('liveness_violation', 1.0, null, JSON.stringify({
              category: 'browser_integrity_violation',
              details: {
                webdriver: isWebdriver,
                headless: isHeadless,
                devtools: isDevToolsOpen,
                dimensions: {
                  inner: `${window.innerWidth}x${window.innerHeight}`,
                  outer: `${window.outerWidth}x${window.outerHeight}`
                }
              }
            }));
          }
        }

        checkCount++;
        if (checkCount >= 5) {
          checkCount = 0;
          const statusType = predictions.length === 0
            ? 'face_not_detected'
            : rawPredictions.length > 1
              ? 'multiple_people'
              : faceInFocus
                ? 'normal'
                : 'face_not_visible';
          const confidence = predictions.length === 1 ? (faceQuality?.confidence ?? 0) : 0.0;
          
          postMonitoringEvent(statusType, confidence, video);
        }
      } catch (err) {
        console.error('Face check error:', err);
      }
    }, 3000);

    const handleVisibility = () => {
      if (!isStartedRef.current) return;
      if (document.hidden) {
        console.log('[Proctoring] Tab switch detected');
        handleStrike('Tab switched');
      }
    };
    const handleBlur = () => {
      if (!isStartedRef.current) return;
      console.log('[Proctoring] Window focus lost');
      handleStrike('Window focus lost');
    };
    
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
      if (faceCheckIntervalRef.current) clearInterval(faceCheckIntervalRef.current);
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      if (videoRecorderRef.current && videoRecorderRef.current.state !== 'inactive') {
        try { videoRecorderRef.current.stop(); } catch (e) {}
      }
    };
  }, [isStarted, interviewId, token, handleStrike, uploadVideo, postMonitoringEvent]);

  if (isTerminated) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-md p-4 animate-in fade-in duration-300">
        <Card className="max-w-md w-full bg-card/45 backdrop-blur-xl border border-destructive/50 shadow-[0_8px_30px_rgb(0,0,0,0.02)] text-center p-8 rounded-2xl animate-in zoom-in-95 duration-500">
          <div className="absolute top-0 left-0 w-full h-1.5 bg-destructive"></div>
          <ShieldAlert className="mx-auto w-16 h-16 text-destructive mb-6 mt-4" />
          <CardTitle className="text-3xl font-black text-destructive mb-4">Session Terminated</CardTitle>
          <p className="text-muted-foreground font-semibold mb-4 leading-relaxed">
            {terminationReason || "This interview has been deactivated due to security protocol violations."}
          </p>
          <p className="text-xs text-destructive/70 font-mono font-bold mb-8 uppercase tracking-widest bg-destructive/10 py-2 rounded-lg">Access Key Invalidated</p>
          <Button variant="outline" className="w-full h-14 rounded-xl font-bold shadow-lg active:scale-[0.99] transition-all" onClick={() => window.location.href = '/calrims/'}>Return to Home</Button>
        </Card>
      </div>
    );
  }

  if (pollingError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-accent/10 p-6 animate-in zoom-in duration-500">
        <Card className="max-w-md w-full bg-card/45 backdrop-blur-xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] rounded-2xl overflow-hidden">
          <div className="h-1.5 bg-destructive w-full" />
          <CardHeader className="text-center p-8 pb-4">
            <ShieldAlert className="mx-auto w-16 h-16 text-destructive mb-4 animate-bounce" />
            <CardTitle className="text-2xl font-black text-foreground tracking-tight">Initialization Delay</CardTitle>
          </CardHeader>
          <CardContent className="px-8 pb-8 space-y-6 text-center">
            <p className="text-muted-foreground font-semibold text-sm leading-relaxed">
              {pollingError}
            </p>
            <div className="flex flex-col gap-3 pt-2">
              <Button
                className="w-full h-14 rounded-xl font-black text-base shadow-lg shadow-primary/20 active:scale-[0.99] transition-all"
                onClick={handleRetryPoll}
              >
                Retry Initialization
              </Button>
              <Button
                variant="outline"
                className="w-full h-14 rounded-xl font-bold text-slate-500 hover:text-slate-700 active:scale-[0.99] transition-all"
                onClick={() => window.location.href = '/calrims/'}
              >
                Go Back to Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-br from-primary/10 via-background to-accent/10 space-y-6">
        <Loader2 className="w-12 h-12 animate-spin text-primary" />
        <h2 className="text-2xl font-black text-foreground tracking-tight">Initializing AI Board...</h2>
        <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Preparing Your Questions</p>
      </div>
    );
  }

  if (!isStarted) {
    return (
      <div className="min-h-screen w-full overflow-y-auto py-12 flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-accent/10 px-6 relative">
        <Card className="max-w-3xl w-full bg-card/45 backdrop-blur-xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] rounded-2xl overflow-hidden animate-in zoom-in duration-500 my-auto relative">
          <div className="h-1.5 bg-gradient-to-r from-primary to-accent w-full" />
          <CardHeader className="text-center p-8 pb-4">
            <BrainCircuit className="w-16 h-16 text-primary mx-auto mb-4" />
            <CardTitle className="text-3xl font-black text-foreground tracking-tight">Ready to Begin?</CardTitle>
            <p className="text-base text-muted-foreground font-semibold mt-2 italic">"True intelligence is the ability to adapt to change."</p>
          </CardHeader>
          <CardContent className="px-8 space-y-6">
            {/* Live Camera Preview */}
            <div className="flex flex-col items-center justify-center">
              <div className="w-full max-w-md aspect-video bg-slate-950 rounded-2xl border border-border/80 shadow-2xl overflow-hidden relative">
                <video
                  ref={sessionVideoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
                <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center bg-black/60 backdrop-blur-md px-4 py-2 rounded-xl text-white">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-white/95">Camera Preview</span>
                  </div>
                  <span className="text-[9px] font-bold text-white/70">Verify framing before entering</span>
                </div>
              </div>

              {/* Microphone Volume Indicator */}
              <div className="w-full max-w-md mt-4 p-4 bg-muted/40 rounded-2xl border border-border/60 flex flex-col gap-2 shadow-sm">
                <div className="flex justify-between items-center w-full">
                   <span className="text-xs font-black text-foreground uppercase tracking-widest">Microphone Test</span>
                   <span className="text-[10px] font-bold text-muted-foreground">Speak to check levels</span>
                </div>
                <div className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                   <div id="mic-volume-bar" className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-100 ease-out" style={{ width: '0%' }} />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-6 bg-muted/40 rounded-2xl border border-border/60">
                <h3 className="font-black text-foreground uppercase tracking-widest text-xs mb-3">Session Secure</h3>
                <p className="text-sm text-muted-foreground font-semibold leading-relaxed">System will monitor your window focus to ensure interview integrity.</p>
              </div>
              <div className="p-6 bg-muted/40 rounded-2xl border border-border/60">
                <h3 className="font-black text-foreground uppercase tracking-widest text-xs mb-3">Session Recording</h3>
                <p className="text-sm text-muted-foreground font-semibold leading-relaxed">Video and audio will be recorded for HR review. Ensure a quiet, well-lit environment.</p>
              </div>
            </div>
            <div className="flex flex-col items-center gap-4 pt-4 w-full">
              {/* Premium Device Test Warning */}
              {!isDeviceTestSuccess && (
                <div className="w-full p-6 bg-red-500/10 border border-red-500/20 rounded-2xl flex gap-4 items-start text-left animate-in fade-in slide-in-from-bottom-4 duration-300">
                  <ShieldAlert className="w-6 h-6 text-red-500 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-black text-red-500 uppercase tracking-wider text-xs mb-1">Hardware Authorization Required</h4>
                    <p className="text-xs text-red-600/90 font-bold leading-relaxed">
                      Camera and Microphone permissions are strictly mandatory to start the assessment. 
                      {deviceTestError && <span className="block mt-1 font-mono text-[10px] text-red-500/70">Error: {deviceTestError}</span>}
                    </p>
                  </div>
                </div>
              )}

              <Button
                disabled={!isDeviceTestSuccess || isStarting}
                className={`w-full h-16 rounded-2xl font-black text-xl shadow-xl transition-all duration-300 active:scale-[0.99] ${
                  !isDeviceTestSuccess 
                    ? 'bg-slate-300 text-slate-500 cursor-not-allowed shadow-none hover:bg-slate-300' 
                    : 'shadow-primary/20 cursor-pointer'
                }`}
                onClick={async () => {
                  if (isStarting) return;
                  setIsStarting(true);
                  // Request fullscreen before starting interview
                  try {
                    await document.documentElement.requestFullscreen();
                    setIsFullscreen(true);
                  } catch (e) {
                    // Fullscreen failed — show gate instead of starting
                    setShowFullscreenGate(true);
                    setIsStarting(false);
                    return;
                  }
                  try {
                    await apiFetch(`/api/interviews/${interviewId}/start`, token, {
                      method: 'POST',
                      body: JSON.stringify({ camera_active: true, mic_active: true }),
                    });
                    sessionStartRef.current = Date.now();
                    setIsStarted(true);
                  } catch (err: any) {
                    toast.error(err.message || 'Failed to start interview session.');
                    if (document.fullscreenElement) {
                      await document.exitFullscreen().catch(() => null);
                    }
                    setIsFullscreen(false);
                    setIsStarting(false);
                  }
                }}
              >
                {isStarting ? 'Starting...' : 'Enter Interview Board'}
              </Button>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">By clicking, you agree to the assessment monitoring protocol</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isFinished) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-accent/10 p-6">
        <Card className="max-w-3xl w-full bg-card/45 backdrop-blur-xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] rounded-2xl overflow-hidden animate-in zoom-in duration-500">
          <div className="h-1.5 bg-gradient-to-r from-primary via-green-500 to-emerald-400 w-full" />
          <CardHeader className="text-center p-12 space-y-6">
            <div className="relative flex items-center justify-center mx-auto w-24 h-24">
              <div className="absolute inset-0 rounded-full bg-green-500/10 animate-ping" />
              <div className="relative w-20 h-20 rounded-full bg-green-500/15 border-2 border-green-500/30 flex items-center justify-center">
                <ShieldCheck className="w-10 h-10 text-green-500 animate-pulse" />
              </div>
            </div>
            <CardTitle className="text-4xl font-black text-foreground tracking-tight">Interview Completed</CardTitle>
            <p className="text-xl text-muted-foreground font-semibold leading-relaxed max-w-2xl mx-auto">
              Thank you for completing your interview! Your responses and proctoring logs have been securely submitted to the hiring team.
            </p>
            <div className="pt-4">
              <span className="text-sm font-bold text-green-800 dark:text-green-300 bg-green-500/10 border border-green-500/20 py-3.5 px-8 rounded-2xl inline-block shadow-sm">
                You can now safely close this window. HR will contact you regarding next steps.
              </span>
            </div>
          </CardHeader>
        </Card>

        <FeedbackDialog
          open={showFeedbackPanel}
          onOpenChange={setShowFeedbackPanel}
          interviewId={interviewId}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background/50">
      <div className="flex flex-1 overflow-hidden">

        {/* Left Sidebar */}
        <div className="w-[320px] hidden lg:block border-r border-border/60 bg-card/45 backdrop-blur-md">
          <InterviewSidebar
            currentQuestion={currentQuestionNumber}
            completedQuestions={completedQuestions}
            incorrectQuestions={incorrectQuestions}
            skippedQuestions={skippedQuestions}
            onSelectQuestion={jumpToQuestion}
            strikes={focusStrikes}
            allQuestions={allQuestions}
          />
        </div>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto p-8 lg:p-12 relative no-scrollbar bg-background/20">
          <div className="max-w-5xl mx-auto space-y-10">

            {/* Header */}
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-2xl bg-card/85 border border-border/80 shadow-sm">
                  <BrainCircuit className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h1 className="text-2xl font-black text-foreground tracking-tight">Assessment Board</h1>
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Secure Experience Protocol</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-4 py-2 bg-card/85 border border-border/80 rounded-xl shadow-sm">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] font-black text-foreground uppercase tracking-widest">Live Session</span>
                </div>
                <Button
                  size="sm"
                  onClick={() => setShowIssueDialog(true)}
                  className="text-xs font-black uppercase tracking-widest bg-amber-500/10 hover:bg-amber-500 text-amber-600 hover:text-white border border-amber-500/30 hover:border-amber-500 rounded-xl px-4 py-2 transition-all duration-200 flex items-center gap-2 active:scale-[0.99] cursor-pointer"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Report Issue
                </Button>
                <Button
                  size="sm"
                  onClick={handleEndSession}
                  className="text-xs font-black uppercase tracking-widest bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white border border-red-500/30 hover:border-red-500 rounded-xl px-4 py-2 transition-all duration-200 flex items-center gap-2 active:scale-[0.99] cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  End Session
                </Button>
              </div>
            </div>
            
            {(() => {
               let relNum = currentQuestionNumber;
               if (allQuestions && currentQuestion) {
                 const sameType = allQuestions.filter(q => q.question_type === currentQuestion.question_type)
                                              .sort((a, b) => a.question_number - b.question_number);
                 const idx = sameType.findIndex(q => q.question_number === currentQuestionNumber);
                 if (idx >= 0) relNum = idx + 1;
               }
               return (
                 <QuestionPanel
                   question={currentQuestion}
                   isLoading={!currentQuestion || isEvaluating || isQuestionSwapping}
                   currentQuestionNumber={relNum}
                 />
               );
            })()}

            <AnswerInput
              onSubmit={handleSubmitAnswer}
              onPrev={([...allQuestions].sort((a,b) => a.question_number - b.question_number)[0]?.question_number < currentQuestionNumber) ? handlePrev : undefined}
              onNext={([...allQuestions].sort((a,b) => b.question_number - a.question_number)[0]?.question_number > currentQuestionNumber) ? handleNext : undefined}
              disabled={!currentQuestion || isEvaluating || isQuestionSwapping}
              isEvaluating={isEvaluating}
              interviewId={interviewId}
              isListening={isListening}
              isTranscribing={isTranscribing}
              onStartRecording={startRecording}
              onStopRecording={stopRecording}
              isStuck={false}
              onRetry={() => {}}
              options={currentQuestion?.options}
              initialValue={currentQuestion?.answer_text}
              isSubmitted={completedQuestions.includes(currentQuestionNumber)}
              questionId={currentQuestion?.id}
              onClipboardViolation={handleClipboardViolation}
            />

            {/* Status bar */}
            <div className="flex justify-between items-center pt-8 border-t border-border/40">
              <div className="flex items-center gap-8">
                <div className="flex items-center gap-3">
                  <UserCheck className={`w-5 h-5 ${isFaceDetected ? 'text-green-500' : 'text-slate-300'}`} />
                  <div>
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Identity</div>
                    <div className="text-xs font-bold text-slate-700">{isFaceDetected ? 'Verified' : 'Searching...'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Eye className={`w-5 h-5 ${isFocusingOnMonitor ? 'text-green-500' : 'text-amber-500'}`} />
                  <div>
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Engagement</div>
                    <div className="text-xs font-bold text-slate-700">{isFocusingOnMonitor ? 'Optimal' : 'Flagged'}</div>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">Evaluation Engine</div>
                <div className="text-xs font-bold text-primary">{isEvaluating ? 'Analyzing Protocol...' : 'Standby'}</div>
              </div>
            </div>

          </div>
        </main>
      </div>

      {/* Floating Video Feed — uses its own ref, separate from the pre-start preview */}
      <div className="fixed bottom-8 right-8 w-64 aspect-video bg-slate-950 rounded-2xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden group z-50 hover:border-primary/50 transition-colors">
        <video
          ref={floatingVideoRef}
          autoPlay
          muted
          playsInline
          className={`w-full h-full object-cover transition-all duration-700 ${(!isFaceDetected || !isCameraConnected) ? 'grayscale blur-sm' : ''}`}
        />
        <div className="absolute top-3 left-3 flex gap-1.5">
          <div className={`px-2 py-1 rounded-lg backdrop-blur-md border text-[8px] font-black uppercase tracking-tighter flex items-center gap-1.5 ${(isFaceDetected && isCameraConnected) ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
            <div className={`w-1 h-1 rounded-full ${(isFaceDetected && isCameraConnected) ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
            {(isFaceDetected && isCameraConnected) ? 'Live Session' : 'Sensor Alert'}
          </div>
        </div>
        {isCameraConnected && !isFaceDetected && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
            <ShieldAlert className="w-8 h-8 text-white animate-bounce" />
          </div>
        )}
        {!isCameraConnected && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-[2px] p-2 text-center">
            <CameraOff className="w-8 h-8 text-red-500 mb-2 animate-pulse" />
            <p className="text-[10px] font-bold text-white mb-2">Camera Disconnected</p>
            <Button 
              size="sm" 
              className="h-7 px-3 text-[9px] font-black uppercase tracking-widest bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg"
              onClick={async () => {
                if (initCameraRef.current) {
                  await initCameraRef.current();
                }
              }}
            >
              Reconnect
            </Button>
          </div>
        )}
      </div>

      <IssueReportDialog
        open={showIssueDialog}
        onOpenChange={setShowIssueDialog}
        interviewId={interviewId}
      />

      {/* ── FULLSCREEN GATE OVERLAY ──────────────────────────────────────────────── */}
      {showFullscreenGate && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/95 backdrop-blur-xl p-4 animate-in fade-in duration-200">
          <div className="max-w-md w-full bg-card/45 backdrop-blur-xl border border-border/80 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden animate-in zoom-in-95 duration-300 relative">
            <div className="h-1.5 bg-gradient-to-r from-amber-400 via-orange-500 to-red-500 w-full" />
            <div className="p-10 text-center">
              <div className="w-20 h-20 rounded-full bg-amber-500/10 border-2 border-amber-500/20 flex items-center justify-center mx-auto mb-6">
                <ShieldAlert className="w-10 h-10 text-amber-500 animate-bounce" />
              </div>
              <h2 className="text-2xl font-black text-foreground tracking-tight mb-3">Fullscreen Required</h2>
              <p className="text-muted-foreground font-semibold text-sm leading-relaxed mb-8">
                This assessment must be taken in <strong>fullscreen mode</strong> to maintain exam integrity.
                You cannot proceed until fullscreen is active.
              </p>
              <Button
                className="w-full h-14 rounded-xl font-black text-base shadow-xl shadow-amber-500/20 bg-amber-500 hover:bg-amber-600 text-white flex items-center justify-center gap-2 active:scale-[0.99] transition-all duration-200 cursor-pointer"
                onClick={enterFullscreen}
              >
                Re-enter Fullscreen to Continue
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── ALL DONE MODAL ────────────────────────────────────────────────────── */}
      {showAllDoneModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-lg p-4 animate-in fade-in duration-300">
          <div className="max-w-md w-full bg-card/45 backdrop-blur-xl border border-border/80 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden animate-in zoom-in-95 duration-300 relative">
            <div className="h-1.5 bg-gradient-to-r from-primary via-green-500 to-emerald-400 w-full" />
            <div className="p-10 text-center space-y-5">
              {/* Icon */}
              <div className="w-20 h-20 rounded-full bg-green-500/10 border-2 border-green-500/20 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-10 h-10 text-green-500" />
              </div>
              <div>
                <h2 className="text-2xl font-black text-foreground tracking-tight">All Questions Answered</h2>
                <p className="text-muted-foreground font-semibold text-sm mt-2 leading-relaxed">
                  You have completed all <span className="font-black text-foreground">{allQuestions.length}</span> questions in this assessment.
                </p>
              </div>
              <Button
                className="w-full h-14 rounded-xl font-black text-base shadow-xl shadow-red-500/20 bg-red-500 hover:bg-red-600 text-white flex items-center justify-center gap-2 transition-all duration-200 active:scale-[0.99] cursor-pointer"
                onClick={handleFinalSubmit}
              >
                <LogOut className="w-5 h-5" />
                End Interview
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
