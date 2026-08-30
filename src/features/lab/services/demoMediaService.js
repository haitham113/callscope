function ensureMediaCapabilities(canvas) {
  if (!canvas?.captureStream) {
    throw new Error('Canvas capture is unavailable in this browser.')
  }
  if (!window.AudioContext) {
    throw new Error('Web Audio is unavailable in this browser.')
  }
}

export async function createDemoMedia(canvas) {
  ensureMediaCapabilities(canvas)

  const context = canvas.getContext('2d')
  const audioContext = new AudioContext({ latencyHint: 'interactive' })
  const destination = audioContext.createMediaStreamDestination()
  const carrier = audioContext.createOscillator()
  const pulse = audioContext.createOscillator()
  const pulseDepth = audioContext.createGain()
  const outputGain = audioContext.createGain()
  let animationFrameId = null
  let audioMeterIntervalId = null
  let remoteAudioSource = null
  let analyser = null
  let animationRunning = true
  let nodesDisconnected = false

  carrier.type = 'sine'
  carrier.frequency.value = 523.25
  pulse.type = 'sine'
  pulse.frequency.value = 1.6
  pulseDepth.gain.value = 0.045
  outputGain.gain.value = 0.065
  pulse.connect(pulseDepth)
  pulseDepth.connect(outputGain.gain)
  carrier.connect(outputGain)
  outputGain.connect(destination)
  carrier.start()
  pulse.start()

  if (audioContext.state !== 'running') await audioContext.resume()
  if (audioContext.state !== 'running') {
    throw new Error(`AudioContext did not enter running state (state: ${audioContext.state}).`)
  }

  canvas.width = 1280
  canvas.height = 720

  function drawFrame(now) {
    if (!animationRunning) return
    const seconds = now / 1000
    const glowX = canvas.width * (0.5 + Math.sin(seconds * 0.34) * 0.25)
    const glowY = canvas.height * (0.48 + Math.cos(seconds * 0.27) * 0.2)

    const background = context.createLinearGradient(0, 0, canvas.width, canvas.height)
    background.addColorStop(0, '#061918')
    background.addColorStop(0.55, '#0a2420')
    background.addColorStop(1, '#051110')
    context.fillStyle = background
    context.fillRect(0, 0, canvas.width, canvas.height)

    context.strokeStyle = 'rgba(111, 255, 194, 0.10)'
    context.lineWidth = 1
    const offset = (seconds * 22) % 64
    for (let x = -64 + offset; x < canvas.width + 64; x += 64) {
      context.beginPath()
      context.moveTo(x, 0)
      context.lineTo(x, canvas.height)
      context.stroke()
    }
    for (let y = -64 + offset; y < canvas.height + 64; y += 64) {
      context.beginPath()
      context.moveTo(0, y)
      context.lineTo(canvas.width, y)
      context.stroke()
    }

    const glow = context.createRadialGradient(glowX, glowY, 8, glowX, glowY, 280)
    glow.addColorStop(0, 'rgba(69, 255, 172, 0.28)')
    glow.addColorStop(1, 'rgba(69, 255, 172, 0)')
    context.fillStyle = glow
    context.fillRect(0, 0, canvas.width, canvas.height)

    const pulseRadius = 76 + Math.sin(seconds * 2.2) * 9
    context.beginPath()
    context.arc(canvas.width / 2, canvas.height / 2, pulseRadius, 0, Math.PI * 2)
    context.strokeStyle = '#63f7b2'
    context.lineWidth = 4
    context.stroke()
    context.beginPath()
    context.arc(canvas.width / 2, canvas.height / 2, pulseRadius + 25, 0, Math.PI * 2)
    context.strokeStyle = 'rgba(99, 247, 178, 0.25)'
    context.lineWidth = 2
    context.stroke()

    context.fillStyle = '#e9fff6'
    context.font = '600 46px system-ui, sans-serif'
    context.textAlign = 'center'
    context.fillText('CALLSCOPE LOOPBACK', canvas.width / 2, canvas.height / 2 + 145)
    context.fillStyle = 'rgba(233, 255, 246, 0.7)'
    context.font = '500 22px ui-monospace, monospace'
    context.fillText('GENERATED MEDIA • 30 FPS', canvas.width / 2, canvas.height / 2 + 185)

    animationFrameId = requestAnimationFrame(drawFrame)
  }

  animationFrameId = requestAnimationFrame(drawFrame)
  const videoStream = canvas.captureStream(30)
  const generatedStream = new MediaStream([
    ...destination.stream.getAudioTracks(),
    ...videoStream.getVideoTracks(),
  ])

  function startRemoteAudioMeter(remoteStream, onLevel) {
    const audioTracks = remoteStream.getAudioTracks()
    if (audioTracks.length === 0) return false
    remoteAudioSource = audioContext.createMediaStreamSource(
      new MediaStream(audioTracks),
    )
    analyser = audioContext.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.72
    remoteAudioSource.connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    audioMeterIntervalId = setInterval(() => {
      analyser.getByteTimeDomainData(samples)
      let sum = 0
      for (const value of samples) {
        const centered = (value - 128) / 128
        sum += centered * centered
      }
      onLevel(Math.min(1, Math.sqrt(sum / samples.length) * 5.5))
    }, 100)
    return true
  }

  async function cleanup() {
    if (audioMeterIntervalId !== null) clearInterval(audioMeterIntervalId)
    audioMeterIntervalId = null
    animationRunning = false
    if (animationFrameId !== null) cancelAnimationFrame(animationFrameId)
    animationFrameId = null

    remoteAudioSource?.disconnect()
    analyser?.disconnect()
    try {
      carrier.stop()
      pulse.stop()
    } catch {
      // Oscillator stop is one-shot; cleanup remains idempotent.
    }
    carrier.disconnect()
    pulse.disconnect()
    pulseDepth.disconnect()
    outputGain.disconnect()
    destination.disconnect()
    nodesDisconnected = true

    const generatedTracks = generatedStream.getTracks()
    generatedTracks.forEach((track) => track.stop())
    if (audioContext.state !== 'closed') await audioContext.close()

    return {
      generated_tracks_total: generatedTracks.length,
      generated_tracks_ended: generatedTracks.filter(
        (track) => track.readyState === 'ended',
      ).length,
      audio_context_state: audioContext.state,
      audio_nodes_disconnected: nodesDisconnected,
      animation_active: animationRunning,
      animation_frame_pending: animationFrameId !== null,
      audio_meter_active: audioMeterIntervalId !== null,
    }
  }

  return {
    stream: generatedStream,
    audioContext,
    startRemoteAudioMeter,
    getStatus() {
      return {
        audio_context_state: audioContext.state,
        animation_active: animationRunning,
        audio_meter_active: audioMeterIntervalId !== null,
      }
    },
    cleanup,
  }
}
