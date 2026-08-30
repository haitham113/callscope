<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useLabStore } from '../features/lab/stores/labStore.js'
import { createLabController } from '../features/lab/services/labController.js'
import { detectWebMcpSupport } from '../features/webmcp/webMcpReadiness.js'

const store = useLabStore()
const controller = createLabController(store)
const sourceCanvas = ref(null)
const remoteVideo = ref(null)
const startPending = ref(false)
const {
  sessionId,
  state,
  healthStatus,
  healthScore,
  elapsedSeconds,
  connection,
  tracks,
  metrics,
  audioLevel,
  evidenceChecks,
  timeline,
  lastCleanupReceipt,
  error,
  webMcpSupported,
} = storeToRefs(store)

const canStart = computed(() => ['idle', 'ended', 'failed'].includes(state.value))
const healthTone = computed(() => {
  if (state.value === 'healthy') return 'healthy'
  if (state.value === 'failed') return 'critical'
  if (state.value === 'starting') return 'starting'
  if (state.value === 'ended') return 'neutral'
  return 'ready'
})
const elapsedLabel = computed(() => {
  const minutes = Math.floor(elapsedSeconds.value / 60)
  const seconds = elapsedSeconds.value % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
})
const sessionShort = computed(() => sessionId.value?.slice(0, 8) ?? 'not started')
const endLabel = computed(() => (state.value === 'ended' ? 'Reset lab' : 'End / Reset'))

const metricCards = computed(() => [
  {
    label: 'Outbound bitrate',
    value: formatMetric(metrics.value.outboundBitrateKbps, 0),
    unit: metrics.value.outboundBitrateKbps === null ? '' : 'kbps',
    detail: 'Calculated from consecutive byte counters',
  },
  {
    label: 'Packet loss',
    value: formatMetric(metrics.value.packetLoss, 0),
    unit: metrics.value.packetLoss === null ? '' : 'packets',
    detail: 'Inbound counter; unavailable stays unavailable',
  },
  {
    label: 'RTT / jitter',
    value: formatMetric(metrics.value.latencyMs, 1),
    unit: metrics.value.latencyMs === null ? '' : 'ms',
    detail: 'RTT preferred, jitter used when exposed',
  },
  {
    label: 'Video frame rate',
    value: formatMetric(metrics.value.frameRate, 1),
    unit: metrics.value.frameRate === null ? '' : 'fps',
    detail: 'Derived from real encoded-frame deltas',
  },
])

function formatMetric(value, digits) {
  return Number.isFinite(value) ? value.toFixed(digits) : 'Unavailable'
}

function formatTime(isoDate) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(isoDate))
}

async function startLab() {
  if (!canStart.value || startPending.value) return
  startPending.value = true
  try {
    await controller.start(sourceCanvas.value, remoteVideo.value)
  } finally {
    startPending.value = false
  }
}

async function endOrReset() {
  await controller.end()
}

onMounted(() => store.setWebMcpSupport(detectWebMcpSupport()))
onBeforeUnmount(() => void controller.dispose())
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <a class="brand" href="#workspace" aria-label="CallScope home">
        <span class="brand-mark" aria-hidden="true">
          <span></span><span></span><span></span>
        </span>
        <span>
          <strong>CallScope</strong>
          <small>WebRTC Rescue Room</small>
        </span>
      </a>

      <div class="topbar-actions">
        <span class="readiness-badge" :class="{ supported: webMcpSupported }" data-testid="webmcp-badge">
          <span class="status-dot"></span>
          WebMCP {{ webMcpSupported ? 'ready' : 'not detected' }}
        </span>
        <button class="end-button" type="button" data-testid="end-reset" @click="endOrReset">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 2v7m5.7-4.7a8 8 0 1 1-11.4 0" />
          </svg>
          {{ endLabel }}
        </button>
      </div>
    </header>

    <section class="hero-copy" aria-labelledby="page-title">
      <div>
        <p class="eyebrow">Live browser operations console</p>
        <h1 id="page-title">See the call. Prove the health.</h1>
      </div>
      <p>
        A deterministic WebRTC lab for human–agent recovery—generated locally,
        inspected from real browser evidence, and always under your control.
      </p>
    </section>

    <section id="workspace" class="workspace">
      <article class="panel media-panel">
        <div class="panel-heading">
          <div>
            <span class="panel-kicker">Remote participant</span>
            <h2>Generated media loopback</h2>
          </div>
          <span class="live-indicator" :class="{ active: state === 'healthy' }">
            <span></span>{{ state === 'healthy' ? 'Live' : state }}
          </span>
        </div>

        <div class="video-stage" :class="{ dormant: state !== 'healthy' }">
          <canvas ref="sourceCanvas" aria-hidden="true"></canvas>
          <video ref="remoteVideo" autoplay playsinline muted data-testid="remote-video"></video>

          <div v-if="canStart" class="start-overlay">
            <span class="start-orbit" aria-hidden="true"><span></span></span>
            <h3>{{ state === 'failed' ? 'The last start did not complete' : 'Your rescue room is ready' }}</h3>
            <p>One click creates two real peer connections with generated audio and video.</p>
            <button class="primary-button" type="button" data-testid="start-demo" @click="startLab">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7 5 8 5-8 5V5Z" /></svg>
              Start Demo Lab
            </button>
            <span class="privacy-note">No camera. No microphone. No recording.</span>
          </div>

          <div v-else-if="state === 'starting'" class="start-overlay compact" aria-live="polite">
            <span class="spinner" aria-hidden="true"></span>
            <h3>Establishing the lab</h3>
            <p>Waiting for connected peers and two progressing stats samples.</p>
          </div>

          <div class="video-hud">
            <span>SESSION {{ sessionShort }}</span>
            <span>{{ elapsedLabel }}</span>
          </div>
        </div>

        <div class="signal-row">
          <div class="audio-meter" data-testid="audio-meter">
            <span class="signal-icon" aria-hidden="true">⌁</span>
            <div>
              <span class="signal-label">Received audio activity</span>
              <div class="meter-track">
                <span :style="{ width: `${Math.round(audioLevel * 100)}%` }"></span>
              </div>
            </div>
            <strong>{{ state === 'healthy' ? `${Math.round(audioLevel * 100)}%` : '—' }}</strong>
          </div>
          <div class="track-chips">
            <span :class="{ ok: tracks.audio.readyState === 'live' && tracks.audio.enabled }">
              Audio {{ tracks.audio.readyState }}
            </span>
            <span :class="{ ok: tracks.video.readyState === 'live' && tracks.video.enabled }">
              Video {{ tracks.video.readyState }}
            </span>
          </div>
        </div>
      </article>

      <section class="center-stack">
        <article class="panel health-panel" :data-health="state" data-testid="health-panel">
          <div class="health-topline">
            <span class="panel-kicker">Call health</span>
            <span class="score">{{ healthScore === null ? '—' : healthScore }}<small>/100</small></span>
          </div>
          <div class="health-badge" :class="healthTone" data-testid="health-status">
            <span class="health-glyph" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M4 12h4l2-5 4 10 2-5h4" /></svg>
            </span>
            <div>
              <span>Current status</span>
              <strong>{{ healthStatus }}</strong>
            </div>
          </div>

          <div class="connection-grid">
            <div>
              <span>Outbound peer</span>
              <strong>{{ connection.outbound }}</strong>
            </div>
            <div>
              <span>Inbound peer</span>
              <strong>{{ connection.inbound }}</strong>
            </div>
            <div>
              <span>ICE path</span>
              <strong>{{ connection.ice }}</strong>
            </div>
          </div>

          <ul class="evidence-list" aria-label="Healthy evidence gates">
            <li v-for="(passed, key) in evidenceChecks" :key="key" :class="{ passed }">
              <span aria-hidden="true">{{ passed ? '✓' : '·' }}</span>
              {{ key.replaceAll('_', ' ') }}
            </li>
          </ul>
        </article>

        <article class="metric-grid" aria-label="Live call metrics">
          <div v-for="metric in metricCards" :key="metric.label" class="metric-card">
            <span>{{ metric.label }}</span>
            <strong>{{ metric.value }} <small>{{ metric.unit }}</small></strong>
            <p>{{ metric.detail }}</p>
          </div>
        </article>

        <p v-if="error" class="error-banner" role="alert">{{ error }}</p>
      </section>

      <aside class="right-stack">
        <article class="panel timeline-panel">
          <div class="panel-heading">
            <div>
              <span class="panel-kicker">Shared evidence trail</span>
              <h2>Diagnosis timeline</h2>
            </div>
            <span class="event-count">{{ timeline.length }} events</span>
          </div>

          <ol v-if="timeline.length" class="timeline" data-testid="timeline">
            <li v-for="event in [...timeline].reverse()" :key="event.id">
              <span class="timeline-node" :class="event.actor.toLowerCase()"></span>
              <div>
                <p><strong>{{ event.actor }}</strong><time>{{ formatTime(event.createdAt) }}</time></p>
                <h3>{{ event.title }}</h3>
                <span>{{ event.detail }}</span>
              </div>
            </li>
          </ol>
          <div v-else class="empty-state">
            <span aria-hidden="true">◎</span>
            <h3>Evidence will appear here</h3>
            <p>Start the lab to see every user and system action in sequence.</p>
          </div>
        </article>

        <article class="panel recovery-panel">
          <div class="drawer-handle"></div>
          <span class="panel-kicker">Human-controlled recovery</span>
          <h2>Recovery plan</h2>
          <div class="locked-plan">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V8a5 5 0 0 1 10 0v2m-9 0h8a2 2 0 0 1 2 2v7H6v-7a2 2 0 0 1 2-2Z" /></svg>
            <div>
              <strong>No plan staged</strong>
              <p>Fault diagnosis and recovery controls arrive in the next milestone. No repair can run here yet.</p>
            </div>
          </div>
        </article>
      </aside>
    </section>

    <section v-if="lastCleanupReceipt" class="cleanup-receipt" data-testid="cleanup-receipt">
      <div>
        <span class="receipt-check" :class="{ complete: lastCleanupReceipt.complete }">{{ lastCleanupReceipt.complete ? '✓' : '!' }}</span>
        <div>
          <span class="panel-kicker">Last cleanup receipt</span>
          <strong>{{ lastCleanupReceipt.complete ? 'All tracked browser resources released' : 'Cleanup needs attention' }}</strong>
        </div>
      </div>
      <ul>
        <li>Peers {{ lastCleanupReceipt.peers.peer_connections_closed }}/{{ lastCleanupReceipt.peers.peer_connections_total }} closed</li>
        <li>Generated tracks {{ lastCleanupReceipt.media.generated_tracks_ended }}/{{ lastCleanupReceipt.media.generated_tracks_total }} ended</li>
        <li>Remote tracks {{ lastCleanupReceipt.peers.remote_tracks_ended }}/{{ lastCleanupReceipt.peers.remote_tracks_total }} ended</li>
        <li>AudioContext {{ lastCleanupReceipt.media.audio_context_state }}</li>
        <li>Sampler {{ lastCleanupReceipt.sampler.sampler_active ? 'active' : 'stopped' }}</li>
        <li>Animation {{ lastCleanupReceipt.media.animation_active ? 'active' : 'stopped' }}</li>
      </ul>
    </section>

    <section class="agent-prompt">
      <div class="agent-avatar" aria-hidden="true">✦</div>
      <div>
        <span>Suggested agent prompt</span>
        <p>“Why is this call silent? Diagnose it and stage the safest repair.”</p>
        <small>Agent diagnosis is intentionally not active in Milestone 1.</small>
      </div>
      <button type="button" disabled title="WebMCP tools are introduced in a later milestone">Copy later</button>
    </section>

    <footer>
      <p>Generated media stays in this page. No recording, raw IP display, or external media service.</p>
      <span>Milestone 1 · Deterministic lab</span>
    </footer>
  </main>
</template>
