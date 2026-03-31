'use client';

import * as React from 'react';
import { Mic, MicOff, Loader2, Phone, PhoneOff, Sparkles, RotateCcw } from 'lucide-react';
import type { CoworkSession, ProcessInstance } from '@mediforce/platform-core';
import { createVoiceEphemeralKey, synthesizeArtifact, finalizeSession } from '@/app/actions/cowork';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { ArtifactPanel } from './artifact-panel';
import { ContextPanel } from './context-panel';

// ---------------------------------------------------------------------------
// Props — same interface as ChatCoworkView
// ---------------------------------------------------------------------------

interface VoiceCoworkViewProps {
  session: CoworkSession;
  instance: ProcessInstance | null;
  handle: string;
  stepDescription?: string;
}

// ---------------------------------------------------------------------------
// OpenAI Realtime data channel event types
// ---------------------------------------------------------------------------

interface RealtimeEvent {
  type: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// VoiceCoworkView
// ---------------------------------------------------------------------------

export function VoiceCoworkView({ session, instance, handle, stepDescription }: VoiceCoworkViewProps) {
  const maxDuration = session.voiceConfig?.maxDurationSeconds ?? 600;
  const idleTimeout = session.voiceConfig?.idleTimeoutSeconds ?? 60;

  // Voice connection state
  const [voiceStatus, setVoiceStatus] = React.useState<'idle' | 'connecting' | 'connected' | 'ended'>('idle');
  const [muted, setMuted] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);

  // Transcript state
  const [userTranscript, setUserTranscript] = React.useState<string[]>([]);
  const [agentTranscript, setAgentTranscript] = React.useState<string[]>([]);
  const [currentAgentText, setCurrentAgentText] = React.useState('');

  // Artifact state
  const [artifact, setArtifact] = React.useState<Record<string, unknown> | null>(session.artifact);
  const [synthesizing, setSynthesizing] = React.useState(false);
  const [synthComment, setSynthComment] = React.useState('');

  // Finalization state
  const [finalizing, setFinalizing] = React.useState(false);
  const [finalized, setFinalized] = React.useState(session.status === 'finalized');

  // Refs
  const pcRef = React.useRef<RTCPeerConnection | null>(null);
  const dcRef = React.useRef<RTCDataChannel | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const transcriptEndRef = React.useRef<HTMLDivElement>(null);
  const elapsedIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const idleTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastActivityRef = React.useRef(Date.now());

  // Auto-scroll transcript
  React.useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [userTranscript, agentTranscript, currentAgentText]);

  // ------------------------------------------------------------------
  // Build full transcript string
  // ------------------------------------------------------------------
  const fullTranscript = React.useMemo(() => {
    const lines: string[] = [];
    const maxLen = Math.max(userTranscript.length, agentTranscript.length);
    for (let idx = 0; idx < maxLen; idx++) {
      if (idx < userTranscript.length) lines.push(`User: ${userTranscript[idx]}`);
      if (idx < agentTranscript.length) lines.push(`Agent: ${agentTranscript[idx]}`);
    }
    return lines.join('\n');
  }, [userTranscript, agentTranscript]);

  // ------------------------------------------------------------------
  // Cleanup function
  // ------------------------------------------------------------------
  const cleanup = React.useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    dcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current = null;
    }
    if (elapsedIntervalRef.current) {
      clearInterval(elapsedIntervalRef.current);
      elapsedIntervalRef.current = null;
    }
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }, []);

  // Cleanup on unmount + beforeunload
  React.useEffect(() => {
    const handleUnload = () => cleanup();
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      cleanup();
    };
  }, [cleanup]);

  // ------------------------------------------------------------------
  // Reset idle timer (called on any audio activity)
  // ------------------------------------------------------------------
  const resetIdleTimer = React.useCallback(() => {
    lastActivityRef.current = Date.now();
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      // Idle timeout — auto-end session
      endSession('Idle timeout — no speech detected');
    }, idleTimeout * 1000);
  }, [idleTimeout]);

  // ------------------------------------------------------------------
  // End session
  // ------------------------------------------------------------------
  const endSession = React.useCallback((reason?: string) => {
    cleanup();
    setVoiceStatus('ended');
    if (reason) setError(reason);
  }, [cleanup]);

  // ------------------------------------------------------------------
  // Send event over data channel
  // ------------------------------------------------------------------
  const sendDataChannelEvent = React.useCallback((event: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === 'open') {
      dc.send(JSON.stringify(event));
    }
  }, []);

  // ------------------------------------------------------------------
  // Handle Realtime events from data channel
  // ------------------------------------------------------------------
  const handleRealtimeEvent = React.useCallback((event: RealtimeEvent) => {
    switch (event.type) {
      case 'conversation.item.input_audio_transcription.completed': {
        const transcript = (event as Record<string, unknown>).transcript as string;
        if (transcript?.trim()) {
          setUserTranscript((prev) => [...prev, transcript.trim()]);
          resetIdleTimer();
        }
        break;
      }

      case 'response.audio_transcript.delta': {
        const delta = (event as Record<string, unknown>).delta as string;
        setCurrentAgentText((prev) => prev + delta);
        resetIdleTimer();
        break;
      }

      case 'response.audio_transcript.done': {
        const transcript = (event as Record<string, unknown>).transcript as string;
        if (transcript?.trim()) {
          setAgentTranscript((prev) => [...prev, transcript.trim()]);
        }
        setCurrentAgentText('');
        break;
      }

      // Live artifact — model calls update_artifact tool during voice
      case 'response.function_call_arguments.done': {
        const toolEvent = event as Record<string, unknown>;
        const toolName = toolEvent.name as string;
        const callId = toolEvent.call_id as string;
        if (toolName === 'update_artifact') {
          try {
            const parsed = JSON.parse(toolEvent.arguments as string);
            setArtifact(parsed.artifact ?? parsed);
          } catch {
            // ignore parse errors
          }
          // Send tool result back so the model continues
          sendDataChannelEvent({
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: callId,
              output: JSON.stringify({ status: 'ok', message: 'Artifact updated' }),
            },
          });
          sendDataChannelEvent({ type: 'response.create' });
        }
        break;
      }
    }
  }, [resetIdleTimer, sendDataChannelEvent]);

  // ------------------------------------------------------------------
  // Start voice session
  // ------------------------------------------------------------------
  const startSession = React.useCallback(async () => {
    setVoiceStatus('connecting');
    setError(null);
    setUserTranscript([]);
    setAgentTranscript([]);
    setCurrentAgentText('');
    setElapsed(0);

    try {
      // 1. Get ephemeral key via server action
      const result = await createVoiceEphemeralKey(session.id);
      if (!result.success || !result.ephemeralKey) {
        throw new Error(result.error ?? 'Failed to create voice session');
      }

      // 2. Get microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // 3. Create peer connection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // 4. Remote audio playback
      const audioEl = new Audio();
      audioEl.autoplay = true;
      audioRef.current = audioEl;
      pc.ontrack = (event) => {
        audioEl.srcObject = event.streams[0];
      };

      // 5. Add mic track
      pc.addTrack(stream.getTracks()[0]);

      // 6. Data channel for events
      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;

      dc.onopen = () => {
        setVoiceStatus('connected');

        // Start elapsed timer
        const start = Date.now();
        elapsedIntervalRef.current = setInterval(() => {
          setElapsed(Math.floor((Date.now() - start) / 1000));
        }, 1000);

        // Start max duration timer
        maxTimerRef.current = setTimeout(() => {
          endSession('Maximum session duration reached');
        }, maxDuration * 1000);

        // Start idle timer
        resetIdleTimer();
      };

      dc.onmessage = (event) => {
        handleRealtimeEvent(JSON.parse(event.data));
      };

      // 7. Create offer and connect to OpenAI
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const model = result.model ?? 'gpt-4o-realtime-preview';
      const sdpRes = await fetch(`https://api.openai.com/v1/realtime?model=${model}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${result.ephemeralKey}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
      });

      if (!sdpRes.ok) {
        throw new Error(`WebRTC SDP exchange failed: ${sdpRes.status}`);
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
      setVoiceStatus('idle');
      cleanup();
    }
  }, [session.id, maxDuration, cleanup, endSession, handleRealtimeEvent, resetIdleTimer]);

  // ------------------------------------------------------------------
  // Toggle mute
  // ------------------------------------------------------------------
  const toggleMute = React.useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      const track = stream.getAudioTracks()[0];
      track.enabled = !track.enabled;
      setMuted(!track.enabled);
    }
  }, []);

  // ------------------------------------------------------------------
  // Auto-synthesize when voice ends
  // ------------------------------------------------------------------
  React.useEffect(() => {
    if (voiceStatus === 'ended' && fullTranscript.length > 0 && !artifact && !synthesizing) {
      handleSynthesize();
    }
  }, [voiceStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------------
  // Synthesize artifact from transcript
  // ------------------------------------------------------------------
  const handleSynthesize = React.useCallback(async () => {
    if (!fullTranscript) return;
    setSynthesizing(true);
    setError(null);
    try {
      const result = await synthesizeArtifact(session.id, fullTranscript, synthComment || undefined);
      if (!result.success) {
        throw new Error(result.error ?? 'Synthesis failed');
      }
      setArtifact(result.artifact ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Synthesis failed');
    } finally {
      setSynthesizing(false);
    }
  }, [session.id, fullTranscript, synthComment]);

  // ------------------------------------------------------------------
  // Finalize
  // ------------------------------------------------------------------
  const handleFinalize = React.useCallback(async () => {
    if (!artifact) return;
    setFinalizing(true);
    try {
      const result = await finalizeSession(session.id, artifact);
      if (!result.success) {
        throw new Error(result.error ?? 'Finalization failed');
      }
      setFinalized(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Finalization failed');
    } finally {
      setFinalizing(false);
    }
  }, [session.id, artifact]);

  // ------------------------------------------------------------------
  // Timer display helpers
  // ------------------------------------------------------------------
  const timerPercent = maxDuration > 0 ? elapsed / maxDuration : 0;
  const timerColor = timerPercent >= 0.8 ? 'text-red-500' : timerPercent >= 0.6 ? 'text-amber-500' : 'text-green-600';

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <div className="flex gap-4 h-[calc(100vh-12rem)]">
      {/* Left panel — voice controls + transcript */}
      <div className="flex flex-1 flex-col rounded-xl border bg-card shadow-sm overflow-hidden">
        <ContextPanel session={session} instance={instance} handle={handle} />

        {/* Voice controls bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b bg-muted/20">
          {voiceStatus === 'idle' && (
            <button
              onClick={startSession}
              disabled={finalized}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Phone className="h-4 w-4" />
              Start voice session
            </button>
          )}

          {voiceStatus === 'connecting' && (
            <div className="inline-flex items-center gap-2 rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Connecting...
            </div>
          )}

          {voiceStatus === 'connected' && (
            <>
              <button
                onClick={toggleMute}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  muted
                    ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900 dark:text-red-300'
                    : 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900 dark:text-green-300',
                )}
              >
                {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
              <button
                onClick={() => endSession()}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
              >
                <PhoneOff className="h-4 w-4" />
                End
              </button>
              <span className="flex items-center gap-1.5 text-xs">
                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span className={cn('font-mono tabular-nums', timerColor)}>
                  {formatTimer(elapsed)} / {formatTimer(maxDuration)}
                </span>
              </span>
            </>
          )}

          {voiceStatus === 'ended' && !finalized && (
            <>
              <button
                onClick={startSession}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Phone className="h-4 w-4" />
                New voice session
              </button>
              {fullTranscript.length > 0 && (
                <div className="flex items-center gap-2 ml-auto">
                  <input
                    type="text"
                    placeholder="Additional instructions..."
                    value={synthComment}
                    onChange={(event) => setSynthComment(event.target.value)}
                    className="h-8 rounded-md border bg-background px-2 text-sm w-48"
                  />
                  <button
                    onClick={handleSynthesize}
                    disabled={synthesizing}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 transition-colors disabled:opacity-50"
                  >
                    {synthesizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    Re-synthesize
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Step description */}
        {stepDescription && (
          <div className="px-4 py-2 border-b bg-amber-50 dark:bg-amber-950/30">
            <p className="text-sm text-amber-800 dark:text-amber-200">{stepDescription}</p>
          </div>
        )}

        {/* Transcript */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {userTranscript.length === 0 && agentTranscript.length === 0 && !currentAgentText && (
            <p className="text-sm text-muted-foreground italic text-center mt-8">
              {voiceStatus === 'connected' ? 'Start speaking...' : voiceStatus === 'idle' ? 'Click "Start voice session" to begin' : 'No transcript yet'}
            </p>
          )}
          {Array.from({ length: Math.max(userTranscript.length, agentTranscript.length) }).map((_, idx) => (
            <React.Fragment key={idx}>
              {idx < userTranscript.length && (
                <div className="flex gap-2">
                  <span className="text-xs font-semibold text-blue-500 shrink-0 mt-0.5 w-8">You</span>
                  <p className="text-sm">{userTranscript[idx]}</p>
                </div>
              )}
              {idx < agentTranscript.length && (
                <div className="flex gap-2">
                  <span className="text-xs font-semibold text-purple-500 shrink-0 mt-0.5 w-8">AI</span>
                  <p className="text-sm">{agentTranscript[idx]}</p>
                </div>
              )}
            </React.Fragment>
          ))}
          {currentAgentText && (
            <div className="flex gap-2">
              <span className="text-xs font-semibold text-purple-500 shrink-0 mt-0.5 w-8">AI</span>
              <p className="text-sm text-muted-foreground">{currentAgentText}</p>
            </div>
          )}
          {synthesizing && (
            <div className="flex items-center gap-2 text-sm text-teal-600 mt-4">
              <Sparkles className="h-4 w-4 animate-pulse" />
              Synthesizing artifact with Claude...
            </div>
          )}
          <div ref={transcriptEndRef} />
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-4 mb-3 rounded-lg border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* Finalized banner */}
        {finalized && instance && (
          <div className="mx-4 mb-3 rounded-lg border border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950 px-3 py-2 text-sm text-green-700 dark:text-green-300 flex items-center justify-between">
            <span>Session finalized. Workflow resumed.</span>
            <a
              href={routes.workflowRun(handle, instance.definitionName, instance.id)}
              className="text-green-700 dark:text-green-300 underline font-medium"
            >
              View run
            </a>
          </div>
        )}
      </div>

      {/* Right panel — artifact */}
      <ArtifactPanel
        artifact={artifact}
        outputSchema={session.outputSchema}
        finalized={finalized}
        finalizing={finalizing}
        onFinalize={handleFinalize}
      />
    </div>
  );
}
