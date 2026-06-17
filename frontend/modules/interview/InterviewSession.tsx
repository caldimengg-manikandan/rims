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
import '@tensorflow/tfjs-backend-cpu';
import * as blazeface from '@tensorflow-models/blazeface';
import {
  Loader2, ShieldCheck, ShieldAlert,
  UserCheck, Eye, BrainCircuit, CheckCircle2, Trophy, LogOut, CameraOff, AlertTriangle
} from 'lucide-react';
import InterviewSidebar from './InterviewSidebar';
import { FeedbackDialog, IssueReportDialog } from '@/components/interview-support';

// TF Hub default URL redirects to Kaggle (404) — serve the model from our own origin instead.
const BLAZEFACE_MODEL_URL = '/calrims/models/blazeface/model.json';

async function loadFaceDetector() {
  try {
    await tf.setBackend('webgl');
    await tf.ready();
  } catch (backendErr) {
    console.warn('[FaceCheck] WebGL backend failed, falling back to CPU:', backendErr);
    await tf.setBackend('cpu');
    await tf.ready();
  }

  try {
    const detector = await blazeface.load({ modelUrl: BLAZEFACE_MODEL_URL });
    console.info('[FaceCheck] BlazeFace loaded successfully.');
    return { type: 'blazeface', detector };
  } catch (err) {
    console.error('[FaceCheck] Failed to load BlazeFace detector:', err);
    throw err;
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
    if (res.status === 401) {
      const e = new Error('Session token has been revoked due to proctoring strikes.');
      (e as any).status = 401;
      throw e;
    }
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
  } catch (err) { }
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
      const g = data[i + 1];
      const b = data[i + 2];
      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      colorSum += brightness;
    }
    return colorSum / (30 * 30);
  } catch (e) {
    return 127;
  }
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


function getFaceQuality(prediction: any, video: HTMLVideoElement) {
  let left = 0, top = 0, right = 0, bottom = 0;
  
  if (prediction?.box) {
    left = prediction.box.xMin;
    top = prediction.box.yMin;
    right = prediction.box.xMax || (prediction.box.xMin + prediction.box.width);
    bottom = prediction.box.yMax || (prediction.box.yMin + prediction.box.height);
  } else {
    const extractCoord = (coord: any, index: number, axis: 'x' | 'y') => {
      if (!coord) return 0;
      if (typeof coord.dataSync === 'function') return Number(coord.dataSync()[index] ?? 0);
      if (typeof coord.arraySync === 'function') return Number(coord.arraySync()[index] ?? 0);
      if (Array.isArray(coord)) return Number(coord[index] ?? 0);
      if (typeof coord[index] === 'number') return Number(coord[index]);
      if (typeof coord[axis] === 'number') return Number(coord[axis]);
      return 0;
    };
    const topLeft = prediction?.topLeft || [0, 0];
    const bottomRight = prediction?.bottomRight || [0, 0];
    left = extractCoord(topLeft, 0, 'x');
    top = extractCoord(topLeft, 1, 'y');
    right = extractCoord(bottomRight, 0, 'x');
    bottom = extractCoord(bottomRight, 1, 'y');
  }

  // Ensure left is less than right (in case of horizontal flip bugs)
  const actualLeft = Math.min(left, right);
  const actualRight = Math.max(left, right);
  const actualTop = Math.min(top, bottom);
  const actualBottom = Math.max(top, bottom);

  const width = Math.max(0, actualRight - actualLeft);
  const height = Math.max(0, actualBottom - actualTop);
  // Use videoWidth/videoHeight but fall back to a reasonable default if the
  // video element hasn't reported its native dimensions yet (avoids frameArea=1
  // which makes areaRatio artificially huge).
  const frameW = video.videoWidth > 0 ? video.videoWidth : 640;
  const frameH = video.videoHeight > 0 ? video.videoHeight : 480;
  const frameArea = frameW * frameH;
  const areaRatio = (width * height) / frameArea;
  const rawProbability = prediction?.probability;
  let confidence = 0.8; // default to high confidence when face IS detected but probability parsing fails
  if (typeof rawProbability === 'number') {
    confidence = rawProbability;
  } else if (Array.isArray(rawProbability)) {
    const first = rawProbability[0];
    confidence = typeof first === 'number' ? first : Number(first?.[0] ?? 0.8);
  } else if (rawProbability && typeof rawProbability === 'object' && typeof rawProbability[0] === 'number') {
    // Handle Float32Array / TypedArray (Array.isArray returns false for typed arrays)
    confidence = rawProbability[0];
  }
  // Lenient size threshold: face only needs to be 0.4% of the frame (was 0.8%).
  // This handles cameras where the candidate sits further back.
  const hasReasonableSize = areaRatio >= 0.004;
  // Allow a 30% margin for bounding box coordinates going slightly off-screen
  const marginX = frameW * 0.30;
  const marginY = frameH * 0.30;
  const isInsideFrame = actualLeft >= -marginX && actualTop >= -marginY && actualRight <= frameW + marginX && actualBottom <= frameH + marginY;

  // Calculate if the face center is within the flexible screen percentages
  // X-Axis: middle 40% of the screen (30% to 70%)
  // Y-Axis: between 10th percentile and 70th percentile
  const faceCenterX = actualLeft + width / 2;
  const faceCenterY = actualTop + height / 2;
  
  const minX = frameW * 0.35;
  const maxX = frameW * 0.65; 
  const minY = frameH * 0.40;
  const maxY = frameH * 0.65; 

  // We keep the variable name "isInsideCircle" to avoid refactoring the rest of the tracking architecture
  const isInsideCircle = faceCenterX >= minX && faceCenterX <= maxX && faceCenterY >= minY && faceCenterY <= maxY;

  // Log percentiles for debugging exactly where the candidate's face is
  if (!isInsideCircle && process.env.NODE_ENV !== 'production') {
    const pctX = ((faceCenterX / frameW) * 100).toFixed(1);
    const pctY = ((faceCenterY / frameH) * 100).toFixed(1);
    console.log(`[Face Bounds Debug] Face Center X: ${pctX}% | Face Center Y: ${pctY}%`);
  }

  // A detected face is "in focus" when BlazeFace has reasonable confidence
  // AND the bounding box represents a plausible face (non-zero size, inside frame, and inside the circular guide).
  const inFocus = confidence >= 0.35 && hasReasonableSize && isInsideFrame && isInsideCircle;

  return {
    confidence,
    areaRatio,  // exposed for diagnostic logging
    isInsideFrame,
    isInsideCircle,
    inFocus,
    // Debug variables
    faceCenterX,
    faceCenterY,
    width,
    height,
    actualLeft,
    actualTop,
    actualRight,
    actualBottom,
    frameW,
    frameH
  };
}

function InterviewSession({ sessionId, token }: InterviewSessionProps) {
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
  const [faceInCircle, setFaceInCircle] = useState(true);
  const [isFocusingOnMonitor, setIsFocusingOnMonitor] = useState(true);
  const [faceMissWarning, setFaceMissWarning] = useState<string | null>(null);
  const [faceMissCountdown, setFaceMissCountdown] = useState<number | null>(null);
  const [debugInfo, setDebugInfo] = useState<any>(null); // Added for diagnostic overlay
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

  const videoChunksRef = useRef<Blob[]>([]);
  const activeStreamRef = useRef<MediaStream | null>(null);
  const isSubmittingRef = useRef(false);
  const startSessionVideoRecordingRef = useRef<((stream: MediaStream) => void) | null>(null);

  // Consecutive face miss counter — prevents single-frame glitches from firing strikes
  const consecutiveFacesMissedRef = useRef<number>(0);
  // FIX Issue #2: Raised from 3→5 so detection needs 5 consecutive bad frames (~15 s)
  // before a strike fires, giving the camera/model time to warm up properly.
  const FACE_MISS_THRESHOLD = 5; // require 5 consecutive misses (~15 sec) before a strike
  const isListeningRef = useRef(false);
  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);

  // ── heartbeat tracking (tamper-resistance) ──
  const heartbeatSeqRef = useRef<number>(0);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // ── completion/feedback state ──
  const [showAllDoneModal, setShowAllDoneModal] = useState(false);
  const [showFeedbackPanel, setShowFeedbackPanel] = useState(false);
  const [showIssueDialog, setShowIssueDialog] = useState(false);
  const [finalScores, setFinalScores] = useState<Array<{ question_number: number; question_type: string; score: number | null }>>([]);

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
          if (res.status === 401 && !terminationSentRef.current) {
            terminationSentRef.current = true;
            setIsTerminated(true);
            setTerminationReason("Security violation: Session token has been revoked due to proctoring strikes.");
            return null;
          }
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

  // FIX Issue #1: Stable ref so the proctoring useEffect never needs to list
  // postMonitoringEvent in its dependency array. The ref is kept up-to-date on
  // every render, making it safe to call inside long-lived setInterval callbacks.
  const postMonitoringEventRef = useRef(postMonitoringEvent);
  useEffect(() => {
    postMonitoringEventRef.current = postMonitoringEvent;
  }, [postMonitoringEvent]);

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

      const MAX_STRIKES = 4;
      if (next < MAX_STRIKES) {
        toast.error(`Warning ${next}/${MAX_STRIKES - 1}: ${reason}`, {
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

  // FIX Issue #1: Stable ref for handleStrike — prevents the proctoring useEffect
  // from re-running (and spawning duplicate intervals) whenever handleStrike is
  // recreated due to its own dependency chain changing.
  const handleStrikeRef = useRef(handleStrike);
  useEffect(() => {
    handleStrikeRef.current = handleStrike;
  }, [handleStrike]);



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
          // If 401, also trigger global termination
          if (e.status === 401 || errorMsg.toLowerCase().includes('revoked')) {
            setIsTerminated(true);
            setTerminationReason("Security violation: Session token has been revoked due to proctoring strikes.");
            terminationSentRef.current = true;
          }
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
    const nextQ = [...allQuestions].sort((a, b) => a.question_number - b.question_number).find(q => q.question_number > currentQuestionNumber);
    if (nextQ) {
      if (isQuestionLocked(nextQ.question_number)) {
        toast.warning('Please complete all questions in the current section first.');
        return;
      }
      jumpToQuestion(nextQ.question_number);
    }
  };
  const handlePrev = () => {
    const prevQ = [...allQuestions].sort((a, b) => b.question_number - a.question_number).find(q => q.question_number < currentQuestionNumber);
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
                  for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
                  const avg = sum / dataArray.length;
                  const volBar = document.getElementById('mic-volume-bar');
                  if (volBar) {
                    volBar.style.width = Math.min(100, (avg / 64) * 100) + '%';
                  }



                  requestAnimationFrame(updateVolume);
                };
                updateVolume();
              }
            } catch (e) {
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



  // Proctoring monitors & Video recorder (Runs when isStarted becomes true)
  useEffect(() => {
    if (!isStarted || !activeStreamRef.current) return;

    let checkCount = 0;
    const stream = activeStreamRef.current;
    // cancelled flag: if the effect cleanup runs during the warm-up delay we
    // must not start any intervals (they would never be cleared).
    let cancelled = false;



    // Inner async function so the useEffect callback stays synchronous
    // (React does not accept async effect callbacks directly).
    const startMonitoring = async () => {
      // FIX Issue #2: 2-second camera warm-up delay before starting monitoring.
      // This gives BlazeFace and the camera stream time to produce valid frames,
      // preventing false "face not detected" events on black/uninitialized frames.
      await new Promise<void>(resolve => setTimeout(resolve, 2000));

      // Bail out if the component unmounted or isStarted turned false during warm-up
      if (cancelled) return;

      // After the warm-up, reset the miss counter so any blank frames during
      // warm-up do not carry over into the live session.
      consecutiveFacesMissedRef.current = 0;

      // ─── HEARTBEAT INTERVAL SETUP (MONOTONIC SEQ) ───
      // FIX Issue #1: Use postMonitoringEventRef.current so this interval never
      // becomes stale and the proctoring useEffect dep array stays stable.
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = setInterval(() => {
        if (!isStartedRef.current || terminationSentRef.current) return;
        const currentSeq = heartbeatSeqRef.current;
        heartbeatSeqRef.current += 1;
        postMonitoringEventRef.current('normal', 1.0, null, JSON.stringify({ category: 'heartbeat' }), currentSeq);
      }, 5000);
    };

    startMonitoring();

    if (faceCheckIntervalRef.current) clearInterval(faceCheckIntervalRef.current);
    faceCheckIntervalRef.current = setInterval(async () => {
      if (terminationSentRef.current) return;
      
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
          postMonitoringEventRef.current('face_not_visible', 0, video);
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
        video.play().catch(() => { });
        return;
      }
      
      tf.engine().startScope();
      try {
        // 1. Ambient lighting verification (Audit-only)
        const brightness = getAverageBrightness(video);
        if (brightness < 40) {
          postMonitoringEventRef.current('low_lighting', 0.0, video, JSON.stringify({ brightness }));
        }

        const detectorObj = detectorRef.current;
        let rawPredictions: any[] = [];
        if (detectorObj.type === 'facemesh') {
          rawPredictions = await detectorObj.detector.estimateFaces(video, {
            flipHorizontal: false,
            staticImageMode: false
          });
        } else {
          rawPredictions = await detectorObj.detector.estimateFaces(video, false, false);
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
        setFaceInCircle(predictions.length === 1 ? Boolean(faceQuality?.isInsideCircle) : false);

        if (rawPredictions.length > 1) {
          // Multiple people — immediate strike (clear intent), but still with grace period
          consecutiveFacesMissedRef.current = 0;
          postMonitoringEventRef.current('multiple_people', 0, video);
          handleStrikeRef.current('Multiple people detected');
        } else if (predictions.length === 0 || !faceInFocus) {
          // Face not detected or not in focus — require N consecutive misses before striking
          consecutiveFacesMissedRef.current += 1;
          const reason = predictions.length === 0 ? 'No face detected' : 'Face outside position circle';
          const eventType = predictions.length === 0 ? 'face_not_detected' : 'face_not_visible';
          
          if (consecutiveFacesMissedRef.current === 1) {
            setFaceMissWarning(reason);
            toast.warning(`Warning: ${reason}`, {
              description: "Please center your face inside the camera frame immediately.",
              duration: 4000,
            });
          }
          setFaceMissCountdown(FACE_MISS_THRESHOLD - consecutiveFacesMissedRef.current);

          postMonitoringEventRef.current(eventType, faceQuality?.confidence ?? 0, video);

          // Diagnostic log — helps confirm exactly why inFocus is false
          if (process.env.NODE_ENV !== 'production' || consecutiveFacesMissedRef.current === 1) {
            console.log(
              `[FaceCheck] miss #${consecutiveFacesMissedRef.current}/${FACE_MISS_THRESHOLD}`,
              `| faces=${rawPredictions.length}`,
              `| conf=${faceQuality?.confidence?.toFixed(3) ?? 'n/a'}`,
              `| area=${(faceQuality as any)?.areaRatio?.toFixed(5) ?? 'n/a'}`,
              `| inFrame=${(faceQuality as any)?.isInsideFrame}`,
              `| inCircle=${(faceQuality as any)?.isInsideCircle}`,
              `| inFocus=${faceQuality?.inFocus}`,
              `| videoW=${video.videoWidth} videoH=${video.videoHeight}`,
            );
          }

          if (consecutiveFacesMissedRef.current >= FACE_MISS_THRESHOLD) {
            consecutiveFacesMissedRef.current = 0;
            setFaceMissWarning(null);
            setFaceMissCountdown(null);
            handleStrikeRef.current(reason);
          }
        } else {
          // Face is good — reset miss counter
          if (consecutiveFacesMissedRef.current > 0) {
             setFaceMissWarning(null);
             setFaceMissCountdown(null);
          }
          consecutiveFacesMissedRef.current = 0;
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
          
          postMonitoringEventRef.current(statusType, confidence, video);
        }
      } catch (err) {
        console.error('Face check error:', err);
      } finally {
        tf.engine().endScope();
      }
    }, 3000);

    return () => {
      // Signal the startMonitoring async warm-up to abort if it is still waiting
      cancelled = true;
      // FIX Issue #1: Cleanup only clears intervals/recorder. Blur/visibility
      // listeners are managed by their own isolated useEffect (see below).
      if (faceCheckIntervalRef.current) clearInterval(faceCheckIntervalRef.current);
      if (faceCheckIntervalRef.current) clearInterval(faceCheckIntervalRef.current);
      if (heartbeatIntervalRef.current) clearInterval(heartbeatIntervalRef.current);
    };
  // FIX Issue #1: Dep array reduced to [isStarted] only.
  // All callbacks are accessed via stable refs (postMonitoringEventRef,
  // handleStrikeRef, uploadVideoRef) so changes to those functions never
  // restart this effect and never spawn duplicate setInterval loops.
  }, [isStarted]);

  // FIX Issue #3: Blur / visibility listeners are isolated in their own effect.
  // Previously they lived inside the proctoring useEffect alongside setInterval,
  // so any re-run of that effect would stack multiple blur listeners causing a
  // single window-blur to fire N strikes simultaneously.
  useEffect(() => {
    if (!isStarted) return;
    const handleVisibility = () => {
      if (!isStartedRef.current || terminationSentRef.current) return;
      if (document.hidden) {
        console.log('[Proctoring] Tab switch detected');
        handleStrikeRef.current('Tab switched');
      }
    };
    const handleBlur = () => {
      if (!isStartedRef.current || terminationSentRef.current) return;
      console.log('[Proctoring] Window focus lost');
      handleStrikeRef.current('Window focus lost');
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('blur', handleBlur);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('blur', handleBlur);
    };
  // handleStrikeRef is a ref — stable, never changes.
  // isStarted is the only meaningful dependency here.
  }, [isStarted]);

  // ── PRE-START TRACKING (Device Check Page) ──
  // Continuously verify framing before the interview begins.
  useEffect(() => {
    if (isStarted || isFinished || isTerminated || !isCameraConnected) return;

    const interval = setInterval(async () => {
      const video = sessionVideoRef.current;
      if (!video || video.readyState < 2 || !detectorRef.current) return;
      
      tf.engine().startScope();
      try {
        const detectorObj = detectorRef.current;
        let rawPredictions: any[] = [];
        if (detectorObj.type === 'facemesh') {
          rawPredictions = await detectorObj.detector.estimateFaces(video, { flipHorizontal: false, staticImageMode: false });
        } else {
          rawPredictions = await detectorObj.detector.estimateFaces(video, false, false);
        }

        const faceFound = rawPredictions.length > 0;
        setIsFaceDetected(faceFound);

        let mappedPredictions: any[] = [];
        if (faceFound) {
          const pred = rawPredictions[0];
          if (detectorObj.type === 'facemesh') {
            const box = pred.box;
            mappedPredictions.push({
              topLeft: [box.xMin, box.yMin],
              bottomRight: [box.xMax, box.yMax],
              probability: pred.score ?? 1.0,
            });
          } else {
            mappedPredictions.push(pred);
          }
        }

        if (rawPredictions.length > 1) {
          setFaceMissWarning('Multiple people detected');
          setFaceInCircle(false);
        } else if (mappedPredictions.length === 0) {
          setFaceMissWarning('No face detected');
          setFaceInCircle(false);
        } else {
          const faceQuality = getFaceQuality(mappedPredictions[0], video);
          // Set debug info for the live overlay
          setDebugInfo({
            pred: mappedPredictions[0],
            quality: faceQuality
          });
          setFaceInCircle(Boolean(faceQuality.isInsideCircle));
          if (!faceQuality.inFocus) {
            setFaceMissWarning('Face outside circle');
          } else {
            setFaceMissWarning(null);
          }
        }
      } catch (err) {
        // Ignore errors in pre-start
      } finally {
        tf.engine().endScope();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isStarted, isFinished, isTerminated, isCameraConnected]);

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
        <h2 className="text-2xl font-black text-foreground tracking-tight">Initializing AI Interview...</h2>
        <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Preparing Your Questions</p>
      </div>
    );
  }

  if (!isStarted) {
    return (
      <div className="min-h-screen w-full overflow-y-auto py-12 flex items-center justify-center bg-gradient-to-br from-primary/10 via-background to-accent/10 px-6 relative">
        {process.env.NODE_ENV !== 'production' && debugInfo && (
          <div className="fixed top-0 left-0 bg-black/90 text-green-400 font-mono text-[10px] p-4 z-[9999] max-h-screen overflow-auto max-w-sm border-r border-b border-green-500/30">
            <h3 className="font-bold text-white mb-2">DIAGNOSTICS</h3>
            <pre>{JSON.stringify(debugInfo, null, 2)}</pre>
          </div>
        )}
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
                
                {/* ── CIRCULAR FACE GUIDE OVERLAY ── */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
                    <circle 
                      cx="50" 
                      cy="50" 
                      r="42" 
                      fill="none" 
                      stroke={faceInCircle ? 'rgba(34, 197, 94, 0.7)' : 'rgba(239, 68, 68, 0.7)'} 
                      strokeWidth="2"
                      strokeDasharray="4 4"
                      className={`transition-colors duration-300 ${faceInCircle ? 'animate-pulse' : ''}`}
                    />
                  </svg>
                </div>

                <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center bg-black/60 backdrop-blur-md px-4 py-2 rounded-xl text-white">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${faceInCircle ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                    <span className="text-[10px] font-black uppercase tracking-widest text-white/95">
                      {faceInCircle ? 'Face Positioned' : 'Position Face in Circle'}
                    </span>
                  </div>
                  <span className="text-[9px] font-bold text-white/70">Verify framing before entering</span>
                </div>
              </div>

              {/* ── Dynamic Face Status Label ── */}
              <div className={`w-full max-w-md mt-4 p-4 rounded-2xl border flex items-center gap-3 transition-colors duration-300 shadow-sm ${faceMissWarning ? 'bg-red-500/10 border-red-500/50' : 'bg-green-500/10 border-green-500/50'}`}>
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${faceMissWarning ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} />
                <div className="flex flex-col">
                  <span className={`text-xs font-black uppercase tracking-widest ${faceMissWarning ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                    {faceMissWarning ? 'Tracking Alert' : 'Position Secure'}
                  </span>
                  <span className={`text-[11px] font-bold ${faceMissWarning ? 'text-red-500/80 dark:text-red-400/80' : 'text-green-500/80 dark:text-green-400/80'}`}>
                    {faceMissWarning ? faceMissWarning : 'Face is positioned correctly. Ready to begin.'}
                  </span>
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
                className={`w-full h-16 rounded-2xl font-black text-xl shadow-xl transition-all duration-300 active:scale-[0.99] ${!isDeviceTestSuccess
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
                {isStarting ? 'Starting...' : 'Enter Interview'}
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

                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Secure Protocol</p>
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
              onPrev={([...allQuestions].sort((a, b) => a.question_number - b.question_number)[0]?.question_number < currentQuestionNumber) ? handlePrev : undefined}
              onNext={([...allQuestions].sort((a, b) => b.question_number - a.question_number)[0]?.question_number > currentQuestionNumber) ? handleNext : undefined}
              disabled={!currentQuestion || isEvaluating || isQuestionSwapping}
              isEvaluating={isEvaluating}
              interviewId={interviewId}
              isListening={isListening}
              isTranscribing={isTranscribing}
              onStartRecording={startRecording}
              onStopRecording={stopRecording}
              isStuck={false}
              onRetry={() => { }}
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
      <div className={`fixed bottom-8 right-8 w-64 aspect-video bg-slate-950 rounded-2xl border ${faceMissWarning ? 'border-red-500 animate-pulse scale-110 shadow-[0_0_50px_rgba(239,68,68,0.6)]' : 'border-border/80'} shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden group z-[250] hover:border-primary/50 transition-all duration-300`}>
        <video
          ref={floatingVideoRef}
          autoPlay
          muted
          playsInline
          className={`w-full h-full object-cover transition-all duration-700 ${(!isFaceDetected || !isCameraConnected) ? 'grayscale blur-sm' : ''}`}
        />
        
        {/* ── CIRCULAR FACE GUIDE OVERLAY ── */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
            <circle 
              cx="50" 
              cy="50" 
              r="42" 
              fill="none" 
              stroke={faceInCircle ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)'} 
              strokeWidth="2"
              strokeDasharray="4 4"
              className={`transition-colors duration-300`}
            />
          </svg>
        </div>

        <div className="absolute top-3 left-3 flex gap-1.5">
          <div className={`px-2 py-1 rounded-lg backdrop-blur-md border text-[8px] font-black uppercase tracking-tighter flex items-center gap-1.5 ${(isFaceDetected && isCameraConnected && faceInCircle) ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
            <div className={`w-1 h-1 rounded-full ${(isFaceDetected && isCameraConnected && faceInCircle) ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
            {(isFaceDetected && isCameraConnected && faceInCircle) ? 'Live Session' : 'Position Face'}
          </div>
        </div>
        {faceMissWarning && faceMissCountdown !== null && !isTerminated && (
        <div className="fixed inset-0 z-[200] pointer-events-none flex items-center justify-center bg-red-500/20 backdrop-blur-sm transition-all duration-300">
          <div className="bg-slate-900/90 border-2 border-red-500 text-red-500 rounded-2xl p-8 max-w-lg text-center shadow-[0_0_80px_rgba(239,68,68,0.4)] animate-in zoom-in-95 duration-200">
            <h2 className="text-3xl font-black uppercase tracking-widest mb-4">Tracking Alert</h2>
            <p className="text-xl font-medium text-slate-200 mb-6">{faceMissWarning}</p>
            <div className="text-6xl font-black tabular-nums">{faceMissCountdown}</div>
            <p className="mt-4 text-sm font-semibold uppercase tracking-wider text-red-400">Seconds until strike</p>
          </div>
        </div>
      )}
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

      {/* ── BIG WARNING MODAL FOR FACE OUT OF BOUNDS ── */}
      {faceMissWarning && !isTerminated && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-red-950/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="max-w-xl w-full bg-destructive border-2 border-red-400 shadow-[0_0_100px_rgba(239,68,68,0.5)] rounded-3xl p-10 text-center animate-in zoom-in-95 duration-300">
            <ShieldAlert className="w-24 h-24 text-white mx-auto mb-6 animate-pulse" />
            <h2 className="text-4xl font-black text-white tracking-tight mb-4">WARNING</h2>
            <p className="text-xl text-red-100 font-bold mb-8">
              {faceMissWarning}
            </p>
            <p className="text-md text-red-200 font-semibold mb-2">
              Please reposition your face inside the camera circle immediately to avoid session termination.
            </p>
            <p className="text-sm text-red-300 font-mono font-bold tracking-widest uppercase">
              Action Required
            </p>
          </div>
        </div>
      )}

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

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an unhandled error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white p-6">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 p-8 rounded-2xl text-center space-y-6">
            <div className="w-16 h-16 bg-red-500/10 border border-red-500/20 rounded-full flex items-center justify-center mx-auto">
              <ShieldAlert className="w-8 h-8 text-red-500 animate-pulse" />
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white">Something Went Wrong</h1>
            <p className="text-slate-400 text-sm leading-relaxed font-semibold">
              An unexpected error occurred during your interview session. Please try reloading the page.
            </p>
            <Button 
              onClick={() => window.location.reload()} 
              className="w-full bg-primary text-primary-foreground font-black uppercase py-4 rounded-xl hover:bg-primary/90 transition-all cursor-pointer"
            >
              Reload Session
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function InterviewSessionWithErrorBoundary(props: InterviewSessionProps) {
  return (
    <ErrorBoundary>
      <InterviewSession {...props} />
    </ErrorBoundary>
  );
}
