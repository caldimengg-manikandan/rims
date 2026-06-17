'use client'

import React, { useState, useMemo, useRef } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/app/dashboard/lib/swr-fetcher'
import { getApiBaseUrl } from '@/lib/config'
import { APIClient } from '@/app/dashboard/lib/api-client'
import { toast } from 'sonner'
import {
  Video,
  CameraOff,
  AlertTriangle,
  Target,
  CheckCircle2,
  Filter,
  Clock,
  ShieldAlert,
  Play,
  Maximize2,
  AlertCircle,
  Eye,
  Users,
  Download
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'

const parseNaiveDateTime = (timestampStr: string) => {
  if (!timestampStr) return new Date();
  if (timestampStr.includes('Z') || timestampStr.includes('+')) {
    return new Date(timestampStr);
  }
  // Replace T with space and dashes with slashes to force local timezone parsing
  const sanitized = timestampStr.replace('T', ' ').replace(/-/g, '/');
  const dt = new Date(sanitized);
  if (!isNaN(dt.getTime())) return dt;
  return new Date(timestampStr);
};

interface MonitoringEvent {
  id: number
  interview_id: number
  event_type: 'focus_lost' | 'multiple_faces' | 'no_face' | 'normal' | 'gaze_deviation' | 'low_lighting' | 'clipboard_violation'
  original_event_type?: string
  timestamp: string
  confidence_score?: number
  frame_image_path?: string
  frame_image_url?: string

  is_false_positive?: boolean
  details?: string
}

const normalizeEventType = (type: string): 'focus_lost' | 'multiple_faces' | 'no_face' | 'normal' | 'gaze_deviation' | 'low_lighting' | 'clipboard_violation' => {
  if (!type) return 'normal'
  const t = type.toLowerCase()
  if (t.includes('multiple_people') || t.includes('multiple_faces')) {
    return 'multiple_faces'
  }
  if (t.includes('no_face') || t.includes('face_not_detected') || t.includes('not_in_frame') || t.includes('face_missing')) {
    return 'no_face'
  }
  if (t.includes('gaze_deviation')) {
    return 'gaze_deviation'
  }
  if (t.includes('low_lighting')) {
    return 'low_lighting'
  }
  if (t.includes('clipboard_violation')) {
    return 'clipboard_violation'
  }
  if (
    t.includes('focus_lost') ||
    t.includes('tab_switched') ||
    t.includes('window_focus') ||
    t.includes('fullscreen')
  ) {
    return 'focus_lost'
  }
  return 'normal'
}

interface MonitoringReviewerProps {
  interviewId: number
}

export const MonitoringReviewer: React.FC<MonitoringReviewerProps> = ({ interviewId }) => {
  const { data: events = [], isLoading, error: monitoringError, mutate } = useSWR<MonitoringEvent[]>(
    interviewId ? `/api/interviews/${interviewId}/monitoring-events` : null,
    fetcher
  )

  const [filter, setFilter] = useState<string>('all')
  const [selectedEvent, setSelectedEvent] = useState<MonitoringEvent | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const normalizedEvents = useMemo(() => {
    if (!Array.isArray(events)) return []
    return events.map((ev) => ({
      ...ev,
      original_event_type: ev.event_type,
      event_type: normalizeEventType(ev.event_type),
    }))
  }, [events])

  const filteredEvents = useMemo(() => {
    if (!Array.isArray(normalizedEvents)) return []
    if (filter === 'all') return normalizedEvents
    if (filter === 'warnings') {
      return normalizedEvents.filter((ev) => ev.event_type !== 'normal')
    }
    return normalizedEvents.filter((ev) => ev.event_type === filter)
  }, [normalizedEvents, filter])

  const warningCount = useMemo(() => {
    if (!Array.isArray(normalizedEvents)) return 0
    return normalizedEvents.filter((ev) => ev.event_type !== 'normal').length
  }, [normalizedEvents])

  const counts = useMemo(() => {
    const res = { focus_lost: 0, multiple_faces: 0, no_face: 0, normal: 0, gaze_deviation: 0, low_lighting: 0, clipboard_violation: 0 }
    if (!Array.isArray(normalizedEvents)) return res
    for (const ev of normalizedEvents) {
      if (ev.event_type in res) {
        res[ev.event_type as keyof typeof res]++
      }
    }
    return res
  }, [normalizedEvents])

  const formatTimeOffset = (videoRefVal?: string, timestamp?: string) => {
    if (videoRefVal && videoRefVal.startsWith('offset_')) {
      const sec = parseInt(videoRefVal.replace('offset_', '').replace('s', ''), 10)
      if (!isNaN(sec)) {
        const m = Math.floor(sec / 60)
        const s = sec % 60
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      }
    }
    if (timestamp) {
      const dt = parseNaiveDateTime(timestamp)
      return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    }
    return '00:00'
  }

  const getEventBadge = (type: MonitoringEvent['event_type']) => {
    switch (type) {
      case 'focus_lost':
        return (
          <Badge className="bg-amber-500 text-white font-bold flex items-center gap-1 px-2.5 py-1 text-xs border-none">
            <Target className="w-3.5 h-3.5" /> Focus Away
          </Badge>
        )
      case 'multiple_faces':
        return (
          <Badge className="bg-red-500 text-white font-bold flex items-center gap-1 px-2.5 py-1 text-xs animate-pulse border-none">
            <Users className="w-3.5 h-3.5" /> Multiple People
          </Badge>
        )
      case 'no_face':
        return (
          <Badge className="bg-red-600 text-white font-bold flex items-center gap-1 px-2.5 py-1 text-xs border-none">
            <CameraOff className="w-3.5 h-3.5" /> Face Missing
          </Badge>
        )
      case 'gaze_deviation':
        return (
          <Badge className="bg-yellow-600 text-white font-bold flex items-center gap-1 px-2.5 py-1 text-xs border-none">
            <Target className="w-3.5 h-3.5" /> Gaze Deviation
          </Badge>
        )
      case 'low_lighting':
        return (
          <Badge className="bg-blue-500 text-white font-bold flex items-center gap-1 px-2.5 py-1 text-xs border-none">
            <AlertTriangle className="w-3.5 h-3.5" /> Low Light
          </Badge>
        )
      case 'clipboard_violation':
        return (
          <Badge className="bg-red-700 text-white font-bold flex items-center gap-1 px-2.5 py-1 text-xs animate-bounce border-none">
            <ShieldAlert className="w-3.5 h-3.5" /> Security Alert
          </Badge>
        )
      default:
        return (
          <Badge className="bg-green-500 text-white font-bold flex items-center gap-1 px-2.5 py-1 text-xs border-none">
            <CheckCircle2 className="w-3.5 h-3.5" /> Secure Frame
          </Badge>
        )
    }
  }

  const getEventColorStyle = (type: MonitoringEvent['event_type']) => {
    if (type === 'focus_lost' || type === 'gaze_deviation' || type === 'low_lighting') {
      return 'border-amber-500/30 bg-amber-500/[0.02] dark:bg-amber-500/[0.04] hover:border-amber-500 transition-all duration-300'
    }
    if (['multiple_faces', 'no_face', 'clipboard_violation'].includes(type)) {
      return 'border-red-500/30 bg-red-500/[0.02] dark:bg-red-500/[0.04] hover:border-red-500 transition-all duration-300'
    }
    return 'border-emerald-500/30 bg-emerald-500/[0.02] dark:bg-emerald-500/[0.04] hover:border-emerald-500 transition-all duration-300'
  }

  const toggleFalsePositive = async (eventId: number, currentVal?: boolean) => {
    try {
      await APIClient.post(`/api/interviews/${interviewId}/monitoring-events/${eventId}/flag-false-positive`, {
        is_false_positive: !currentVal
      })
      mutate()
      toast.success(currentVal ? 'Event marked as valid violation' : 'Event marked as false positive')
    } catch (err: any) {
      toast.error(err.message || 'Failed to toggle status')
    }
  }

  const exportToCSV = () => {
    if (!normalizedEvents || normalizedEvents.length === 0) {
      toast.error('No events to export')
      return
    }

    const sortedEvents = [...normalizedEvents].sort((a, b) => {
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    })

    const headers = ['ID', 'Type', 'Time', 'Confidence', 'False Positive', 'Details']
    const rows = sortedEvents.map(ev => [
      ev.id,
      ev.original_event_type || ev.event_type,
      ev.timestamp,
      ev.confidence_score !== undefined ? ev.confidence_score.toFixed(2) : 'N/A',
      ev.is_false_positive ? 'True' : 'False',
      ev.details ? ev.details.replace(/"/g, '""') : ''
    ])

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(val => `"${val}"`).join(','))
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `interview_${interviewId}_monitoring_audit.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    toast.success('Audit logs exported successfully')
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-3xl bg-muted/30 dark:bg-muted/10">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm font-semibold text-muted-foreground">Loading intelligent frame monitoring logs...</p>
      </div>
    )
  }

  if (monitoringError) {
    return (
      <div className="flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-3xl border-destructive/20 bg-destructive/5">
        <AlertCircle className="w-8 h-8 text-destructive mb-3" />
        <p className="text-sm font-semibold text-destructive">Could not load proctoring events</p>
        <p className="text-xs text-destructive/70 mt-1">{(monitoringError as Error).message || 'Please try again later.'}</p>
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="bg-muted/30 border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center border-border">
        <CameraOff className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium text-muted-foreground">No monitoring frames available.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 p-4 rounded-2xl bg-card/45 backdrop-blur-xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)]">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-lg shadow-primary/20">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2 tracking-tight">
              AI Integrity Audit Timeline
              {warningCount > 0 ? (
                <Badge className="bg-destructive text-destructive-foreground font-bold px-2 py-0.5 text-xs animate-bounce border-none">
                  {warningCount} Anomalies
                </Badge>
              ) : (
                <Badge className="bg-emerald-500 text-white font-bold px-2 py-0.5 text-xs border-none">
                  100% Secure
                </Badge>
              )}
            </h3>
            <p className="text-xs font-semibold text-muted-foreground">
              Frame-by-frame chronological audit logs captured silently during the interview.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 items-center">
          <Button
            variant={filter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('all')}
            className="rounded-xl text-xs font-bold active:scale-95 transition-all"
          >
            All ({events.length})
          </Button>
          <Button
            variant={filter === 'warnings' ? 'destructive' : 'outline'}
            size="sm"
            onClick={() => setFilter('warnings')}
            className="rounded-xl text-xs font-bold gap-1 active:scale-95 transition-all"
          >
            <AlertCircle className="w-3.5 h-3.5" /> Anomalies ({warningCount})
          </Button>
          <Button
            variant={filter === 'focus_lost' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('focus_lost')}
            className="rounded-xl text-xs font-bold active:scale-95 transition-all"
          >
            Focus ({counts.focus_lost})
          </Button>
          <Button
            variant={filter === 'multiple_faces' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('multiple_faces')}
            className="rounded-xl text-xs font-bold active:scale-95 transition-all"
          >
            People ({counts.multiple_faces})
          </Button>
          <Button
            variant={filter === 'no_face' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('no_face')}
            className="rounded-xl text-xs font-bold active:scale-95 transition-all"
          >
            No Face ({counts.no_face})
          </Button>
          {counts.gaze_deviation > 0 && (
            <Button
              variant={filter === 'gaze_deviation' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('gaze_deviation')}
              className="rounded-xl text-xs font-bold active:scale-95 transition-all"
            >
              Gaze ({counts.gaze_deviation})
            </Button>
          )}
          {counts.low_lighting > 0 && (
            <Button
              variant={filter === 'low_lighting' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('low_lighting')}
              className="rounded-xl text-xs font-bold active:scale-95 transition-all"
            >
              Lighting ({counts.low_lighting})
            </Button>
          )}
          {counts.clipboard_violation > 0 && (
            <Button
              variant={filter === 'clipboard_violation' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('clipboard_violation')}
              className="rounded-xl text-xs font-bold active:scale-95 transition-all"
            >
              Clipboard ({counts.clipboard_violation})
            </Button>
          )}
          <Button
            variant={filter === 'normal' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter('normal')}
            className="rounded-xl text-xs font-bold active:scale-95 transition-all"
          >
            Secure ({counts.normal})
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={exportToCSV}
            className="rounded-xl text-xs font-bold gap-1 active:scale-95 transition-all border-primary/30 text-primary hover:bg-primary/5 ml-auto"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </Button>
        </div>
      </div>

      <ScrollArea className="h-[480px] rounded-2xl border border-border/80 bg-card/45 backdrop-blur-xl p-4 shadow-[0_8px_30px_rgb(0,0,0,0.02)] scrollbar-premium">
        {filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Filter className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-bold text-muted-foreground">No frames match the selected filter.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filteredEvents.map((ev) => (
              <div
                key={ev.id}
                onClick={() => setSelectedEvent(ev)}
                className={`group relative flex flex-col rounded-2xl border-2 transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.99] hover:shadow-[0_15px_30px_rgb(0,0,0,0.05)] cursor-pointer overflow-hidden ${getEventColorStyle(
                  ev.event_type
                )} ${ev.is_false_positive ? 'opacity-50 grayscale-[30%] border-slate-300/40' : ''}`}
              >
                <div className="relative aspect-video w-full overflow-hidden bg-slate-900">
                  {ev.frame_image_url ? (
                    <img
                      src={ev.frame_image_url?.startsWith('http') ? ev.frame_image_url : `${getApiBaseUrl()}${ev.frame_image_url}`}
                      alt="Monitoring frame"
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-slate-600">
                      <Video className="w-8 h-8" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-80 group-hover:opacity-90 transition-opacity" />
                  
                  <div className="absolute top-2.5 left-2.5 flex flex-col gap-1 items-start">
                    {getEventBadge(ev.event_type)}
                    {ev.is_false_positive && (
                      <Badge className="bg-slate-600 text-white font-bold px-2 py-0.5 text-[10px] border-none shadow-sm">
                        False Positive
                      </Badge>
                    )}
                  </div>
                  
                  <div className="absolute bottom-2.5 left-2.5 flex items-center gap-1.5 text-xs font-bold text-white bg-black/60 backdrop-blur-md px-2 py-1 rounded-lg">
                    <Clock className="w-3.5 h-3.5 text-blue-400" />
                    {new Date(ev.timestamp).toLocaleTimeString()}
                  </div>

                  <div className="absolute inset-0 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/55 backdrop-blur-sm gap-2 p-2">
                    <Button
                      size="sm"
                      className="w-11/12 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white h-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedEvent(ev);
                      }}
                    >
                      <Maximize2 className="w-3.5 h-3.5 mr-1" /> Inspect Frame
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-11/12 text-xs font-bold rounded-xl bg-white/10 hover:bg-white/20 text-white border-white/20 h-8"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await toggleFalsePositive(ev.id, ev.is_false_positive);
                      }}
                    >
                      {ev.is_false_positive ? 'Mark as Valid' : 'Flag False Positive'}
                    </Button>
                  </div>
                </div>

                <div className="p-3 flex items-center justify-center bg-card/45 backdrop-blur-xl border-t border-border text-center">
                  <span className="text-xs font-bold text-foreground capitalize tracking-wide">
                    {ev.original_event_type ? ev.original_event_type.replace(/_/g, ' ') : ev.event_type.replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      <Dialog open={!!selectedEvent} onOpenChange={() => setSelectedEvent(null)}>
        <DialogContent className="max-w-5xl rounded-3xl p-0 border border-border/80 bg-background/90 backdrop-blur-xl shadow-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/40 p-6">
            <DialogHeader>
              <div className="flex items-center justify-between pr-8">
                <div className="flex items-center gap-3">
                  {selectedEvent && getEventBadge(selectedEvent.event_type)}
                  <DialogTitle className="text-xl font-black text-foreground">
                    Frame Audit Inspection
                  </DialogTitle>
                </div>
                <span className="flex items-center gap-1.5 text-sm font-black text-primary bg-primary/10 px-3 py-1.5 rounded-xl border border-primary/20">
                  <Clock className="w-4 h-4" />
                  {selectedEvent && new Date(selectedEvent.timestamp).toLocaleTimeString()}
                </span>
              </div>
              <DialogDescription className="text-xs font-bold text-muted-foreground pt-1">
                Captured at exact timestamp: {selectedEvent && parseNaiveDateTime(selectedEvent.timestamp).toLocaleString()}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="p-6 space-y-4">
            {selectedEvent?.original_event_type && selectedEvent.event_type !== 'normal' && (
              <div className="flex items-center gap-2 p-3.5 rounded-2xl bg-destructive/5 dark:bg-destructive/10 border border-destructive/20 text-destructive text-sm font-bold capitalize animate-pulse">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Violation Detail: {selectedEvent.original_event_type.replace(/_/g, ' ')}</span>
              </div>
            )}
            
            {selectedEvent?.details && (
              <div className="p-3.5 rounded-2xl bg-blue-500/5 dark:bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-sm font-mono leading-relaxed">
                <p className="font-bold mb-1">Audit Details:</p>
                <p className="text-xs break-all">{selectedEvent.details}</p>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <span className="text-xs font-extrabold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Eye className="w-4 h-4 text-primary" /> Frame Snapshot
              </span>
              <div className="rounded-2xl overflow-hidden border-2 border-border aspect-video shadow-lg bg-foreground/90 flex items-center justify-center max-h-[70vh] w-full">
                {selectedEvent?.frame_image_url ? (
                  <img
                    src={selectedEvent.frame_image_url?.startsWith('http') ? selectedEvent.frame_image_url : `${getApiBaseUrl()}${selectedEvent.frame_image_url}`}
                    alt="Inspection Frame"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center text-muted-foreground p-12 text-center w-full">
                    <CameraOff className="w-16 h-16 mb-3 opacity-50" />
                    <p className="text-sm font-bold">No frame snapshot image available for this event.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 px-6 pb-6 pt-2 border-t border-border/40 mt-2">
            {selectedEvent && (
              <Button
                variant={selectedEvent.is_false_positive ? 'outline' : 'destructive'}
                className="rounded-xl font-bold active:scale-[0.98] transition-all"
                onClick={async () => {
                  await toggleFalsePositive(selectedEvent.id, selectedEvent.is_false_positive)
                  setSelectedEvent(prev => prev ? { ...prev, is_false_positive: !prev.is_false_positive } : null)
                }}
              >
                {selectedEvent.is_false_positive ? 'Mark As Valid Anomaly' : 'Flag as False Positive'}
              </Button>
            )}
            <Button variant="default" className="rounded-xl font-bold active:scale-[0.98] transition-all" onClick={() => setSelectedEvent(null)}>
              Done Inspecting
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
