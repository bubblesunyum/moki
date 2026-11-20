import { useEffect, useState } from 'react'
import { Icon, IconButton, Text } from '../../../ui'
import { usePersistentState } from '../hooks/usePersistentState'

export const FOCUS_STORAGE_KEY = 'moki.day.focus'
const FOCUS_MIN_MAX = 180
const BREAK_MIN_MAX = 60

type Phase = 'focus' | 'break' | null
type Status = 'running' | 'paused' | 'pending' | 'idle'

interface FocusPersist {
  date: string
  completedToday: number
}

function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/* A stale stored date means a new day: the count restarts at zero. */
function validatePersist(raw: unknown): FocusPersist | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { date, completedToday } = raw as { date?: unknown; completedToday?: unknown }
  if (typeof completedToday !== 'number') return null
  const today = todayKey()
  if (date !== today) return { date: today, completedToday: 0 }
  return { date: today, completedToday }
}

function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

/* Pomodoro-ish timer, local-first. remainingSec derives from endsAt under a
 * 1s interval; pausing freezes the remainder from endsAt, resuming
 * re-anchors endsAt. The completed count persists per calendar day. */
export function useFocusTimer(): {
  phase: Phase
  status: Status
  remainingSec: number
  focusMin: number
  breakMin: number
  completedToday: number
  start: (phase: 'focus' | 'break') => void
  pause: () => void
  resume: () => void
  reset: () => void
  skip: () => void
  setFocusMin: (min: number) => void
  setBreakMin: (min: number) => void
} {
  const [persist, setPersist] = usePersistentState<FocusPersist>(FOCUS_STORAGE_KEY, validatePersist, {
    date: todayKey(),
    completedToday: 0
  })
  const [phase, setPhase] = useState<Phase>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [endsAt, setEndsAt] = useState<number | null>(null)
  const [remainingSec, setRemainingSec] = useState(25 * 60)
  const [focusMin, setFocusMinState] = useState(25)
  const [breakMin, setBreakMinState] = useState(5)

  useEffect(() => {
    if (status !== 'running' || endsAt === null) return
    const id = window.setInterval(() => {
      const left = Math.max(0, Math.round((endsAt - Date.now()) / 1000))
      if (left > 0) {
        setRemainingSec(left)
        return
      }
      // Ring: a finished focus block counts and offers the earned break;
      // a break just idles out.
      if (phase === 'focus') {
        setPhase('break')
        setStatus('pending')
        setEndsAt(null)
        setRemainingSec(breakMin * 60)
        setPersist((prev) => ({ ...prev, completedToday: prev.completedToday + 1 }))
      } else {
        setPhase(null)
        setStatus('idle')
        setEndsAt(null)
        setRemainingSec(focusMin * 60)
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [status, endsAt, phase, focusMin, breakMin, setPersist])

  function start(next: 'focus' | 'break'): void {
    const secs = (next === 'focus' ? focusMin : breakMin) * 60
    setPhase(next)
    setStatus('running')
    setEndsAt(Date.now() + secs * 1000)
    setRemainingSec(secs)
  }

  function pause(): void {
    if (endsAt !== null) {
      setRemainingSec(Math.max(0, Math.round((endsAt - Date.now()) / 1000)))
    }
    setEndsAt(null)
    setStatus('paused')
  }

  function resume(): void {
    setEndsAt(Date.now() + remainingSec * 1000)
    setStatus('running')
  }

  function reset(): void {
    setPhase(null)
    setStatus('idle')
    setEndsAt(null)
    setRemainingSec(focusMin * 60)
  }

  function skip(): void {
    if (phase === 'focus') {
      setPhase('break')
      setStatus('pending')
      setEndsAt(null)
      setRemainingSec(breakMin * 60)
      setPersist((prev) => ({ ...prev, completedToday: prev.completedToday + 1 }))
    } else {
      setPhase(null)
      setStatus('idle')
      setEndsAt(null)
      setRemainingSec(focusMin * 60)
    }
  }

  /* min/max attrs are hints only — clamp here too. */
  function setFocusMin(min: number): void {
    setFocusMinState(Math.min(FOCUS_MIN_MAX, Math.max(1, Math.floor(min) || 1)))
  }

  function setBreakMin(min: number): void {
    setBreakMinState(Math.min(BREAK_MIN_MAX, Math.max(1, Math.floor(min) || 1)))
  }

  return {
    phase,
    status,
    remainingSec,
    focusMin,
    breakMin,
    completedToday: persist.completedToday,
    start,
    pause,
    resume,
    reset,
    skip,
    setFocusMin,
    setBreakMin
  }
}

export function FocusWidget(): React.JSX.Element {
  const timer = useFocusTimer()
  const [showSettings, setShowSettings] = useState(true)

  const totalSec = (timer.phase === 'break' ? timer.breakMin : timer.focusMin) * 60 || 1
  const fraction = timer.phase === null ? 1 : Math.min(1, Math.max(0, timer.remainingSec / totalSec))
  const isLastMinute = timer.status === 'running' && timer.remainingSec < 60
  const ringTone = isLastMinute ? 'is-urgent' : timer.phase === 'break' ? 'is-break' : 'is-focus'

  const R = 25
  const C = 2 * Math.PI * R

  function centerAction(): void {
    if (timer.status === 'running') timer.pause()
    else if (timer.status === 'paused') timer.resume()
    else if (timer.status === 'pending' && timer.phase === 'break') timer.start('break')
    else timer.start('focus')
  }

  const centerLabel =
    timer.status === 'running'
      ? 'Pause'
      : timer.status === 'paused'
        ? 'Resume'
        : timer.status === 'pending' && timer.phase === 'break'
          ? 'Start break'
          : 'Start focus'

  return (
    <div className="moki-focus" data-testid="focus-widget">
      <div className="moki-focus-main">
        <div className="moki-focus-ringwrap">
          <svg className="moki-focus-ring" width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
            <circle className="moki-focus-track" cx="28" cy="28" r={R} />
            <circle
              className={['moki-focus-arc', ringTone].join(' ')}
              cx="28"
              cy="28"
              r={R}
              strokeDasharray={C}
              strokeDashoffset={C * (1 - fraction)}
            />
          </svg>
          <button type="button" className="moki-focus-transport" onClick={centerAction} aria-label={centerLabel}>
            <Icon name={timer.status === 'running' ? 'pause' : 'play'} size={18} />
          </button>
          <span className="moki-focus-crown" role="status" title={`${timer.completedToday} in Focus today`}>
            {timer.completedToday}
          </span>
        </div>
        <div className="moki-focus-column">
          <div className="moki-focus-timerrow">
            <Text variant="title" as="div" data-testid="focus-clock" className="moki-focus-clock">
              {formatClock(timer.remainingSec)}
            </Text>
            <span className="moki-focus-controls">
              {(timer.status === 'running' || timer.status === 'paused') && (
                <IconButton icon="rotate-cw" label="Reset" size="sm" iconSize={16} onClick={timer.reset} />
              )}
              {timer.status === 'running' && (
                <IconButton icon="skip-forward" label="Skip" size="sm" iconSize={16} onClick={timer.skip} />
              )}
            </span>
          </div>
          <button
            type="button"
            className="moki-focus-pill"
            aria-expanded={showSettings}
            aria-label={`Focus length, ${timer.focusMin} minutes, break length, ${timer.breakMin} minutes. Change durations.`}
            onClick={() => setShowSettings((v) => !v)}
          >
            <Text variant="control" as="span">
              {timer.focusMin} min • {timer.breakMin} min
            </Text>
          </button>
        </div>
      </div>
      {showSettings && (
        <div className="moki-focus-settings">
          <label>
            <Text variant="small">Focus min</Text>
            <input
              aria-label="Focus minutes"
              type="number"
              min={1}
              max={FOCUS_MIN_MAX}
              value={timer.focusMin}
              onChange={(e) => timer.setFocusMin(Number(e.target.value))}
            />
          </label>
          <label>
            <Text variant="small">Break min</Text>
            <input
              aria-label="Break minutes"
              type="number"
              min={1}
              max={BREAK_MIN_MAX}
              value={timer.breakMin}
              onChange={(e) => timer.setBreakMin(Number(e.target.value))}
            />
          </label>
        </div>
      )}
    </div>
  )
}
