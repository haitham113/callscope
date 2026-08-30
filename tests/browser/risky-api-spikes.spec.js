import { expect, test } from '@playwright/test'

test('proves generated media, repeated negotiation, and sender parameter readback', async ({ page }) => {
  await page.setContent('<button id="run" type="button">Run browser API spike</button>')

  const spikeResultPromise = page.evaluate(() =>
    new Promise((resolve) => {
      document.querySelector('#run').addEventListener(
        'click',
        async () => {
          const cycles = []
          for (let cycle = 0; cycle < 3; cycle += 1) {
            const canvas = document.createElement('canvas')
            canvas.width = 320
            canvas.height = 180
            const context = canvas.getContext('2d')
            let rafId = null
            let drawing = true
            let frame = 0
            const draw = () => {
              if (!drawing) return
              context.fillStyle = frame % 2 ? '#22dd88' : '#09241b'
              context.fillRect(0, 0, canvas.width, canvas.height)
              context.fillStyle = '#fff'
              context.fillText(String(frame), 10, 20)
              frame += 1
              rafId = requestAnimationFrame(draw)
            }
            draw()

            const audioContext = new AudioContext()
            const destination = audioContext.createMediaStreamDestination()
            const oscillator = audioContext.createOscillator()
            oscillator.connect(destination)
            oscillator.start()
            await audioContext.resume()
            const audioStartedFromGesture = audioContext.state === 'running'

            const canvasStream = canvas.captureStream(30)
            const stream = new MediaStream([
              ...canvasStream.getVideoTracks(),
              ...destination.stream.getAudioTracks(),
            ])
            const senderPeer = new RTCPeerConnection({ iceServers: [] })
            const receiverPeer = new RTCPeerConnection({ iceServers: [] })
            const pendingSender = []
            const pendingReceiver = []

            const addOrQueue = (target, queue, candidate) => {
              if (!candidate) return
              if (!target.remoteDescription) queue.push(candidate)
              else void target.addIceCandidate(candidate)
            }
            senderPeer.onicecandidate = (event) =>
              addOrQueue(receiverPeer, pendingReceiver, event.candidate)
            receiverPeer.onicecandidate = (event) =>
              addOrQueue(senderPeer, pendingSender, event.candidate)
            stream.getTracks().forEach((track) => senderPeer.addTrack(track, stream))

            const offer = await senderPeer.createOffer()
            await senderPeer.setLocalDescription(offer)
            await receiverPeer.setRemoteDescription(offer)
            for (const candidate of pendingReceiver.splice(0)) {
              await receiverPeer.addIceCandidate(candidate)
            }
            const answer = await receiverPeer.createAnswer()
            await receiverPeer.setLocalDescription(answer)
            await senderPeer.setRemoteDescription(answer)
            for (const candidate of pendingSender.splice(0)) {
              await senderPeer.addIceCandidate(candidate)
            }

            await new Promise((connected, reject) => {
              const timeout = setTimeout(() => reject(new Error('connection timeout')), 10_000)
              const check = () => {
                if (
                  senderPeer.connectionState === 'connected' &&
                  receiverPeer.connectionState === 'connected'
                ) {
                  clearTimeout(timeout)
                  connected()
                }
              }
              senderPeer.onconnectionstatechange = check
              receiverPeer.onconnectionstatechange = check
              check()
            })

            const videoSender = senderPeer
              .getSenders()
              .find((sender) => sender.track?.kind === 'video')
            const originalParameters = videoSender.getParameters()
            const originalMaxBitrate = originalParameters.encodings[0]?.maxBitrate ?? null
            const cappedParameters = videoSender.getParameters()
            if (!cappedParameters.encodings.length) cappedParameters.encodings = [{}]
            cappedParameters.encodings[0].maxBitrate = 64_000
            await videoSender.setParameters(cappedParameters)
            const capReadback = videoSender.getParameters().encodings[0]?.maxBitrate ?? null

            const readFrames = async () => {
              const report = await senderPeer.getStats(videoSender.track)
              let frames = 0
              let packets = 0
              report.forEach((entry) => {
                if (entry.type === 'outbound-rtp' && !entry.isRemote) {
                  frames += entry.framesEncoded ?? 0
                  packets += entry.packetsSent ?? 0
                }
              })
              return { frames, packets }
            }
            const before = await readFrames()
            await new Promise((done) => setTimeout(done, 1200))
            const after = await readFrames()

            const restoreParameters = videoSender.getParameters()
            if (originalMaxBitrate === null) {
              delete restoreParameters.encodings[0].maxBitrate
            } else {
              restoreParameters.encodings[0].maxBitrate = originalMaxBitrate
            }
            await videoSender.setParameters(restoreParameters)
            const restoredReadback =
              videoSender.getParameters().encodings[0]?.maxBitrate ?? null

            drawing = false
            cancelAnimationFrame(rafId)
            stream.getTracks().forEach((track) => track.stop())
            senderPeer.close()
            receiverPeer.close()
            oscillator.stop()
            oscillator.disconnect()
            await audioContext.close()

            cycles.push({
              audioContextStartedFromGesture: audioStartedFromGesture,
              framesProgressed: after.frames > before.frames || after.packets > before.packets,
              configuredCap: capReadback,
              restoredCap: restoredReadback,
              expectedRestoredCap: originalMaxBitrate,
              senderClosed: senderPeer.connectionState === 'closed',
              receiverClosed: receiverPeer.connectionState === 'closed',
              tracksEnded: stream.getTracks().every((track) => track.readyState === 'ended'),
            })
          }
          resolve(cycles)
        },
        { once: true },
      )
    }),
  )

  await page.locator('#run').click()
  const cycles = await spikeResultPromise
  expect(cycles).toHaveLength(3)
  for (const cycle of cycles) {
    expect(cycle).toEqual({
      audioContextStartedFromGesture: true,
      framesProgressed: true,
      configuredCap: 64_000,
      restoredCap: cycle.expectedRestoredCap,
      expectedRestoredCap: cycle.expectedRestoredCap,
      senderClosed: true,
      receiverClosed: true,
      tracksEnded: true,
    })
  }
})

test('registers a temporary tool and dispatches abort cleanup through native WebMCP', async ({ page }) => {
  await page.goto('./')
  const nativeSupported = await page.evaluate(
    () => typeof document.modelContext?.registerTool === 'function',
  )
  test.skip(
    !nativeSupported,
    'Native document.modelContext.registerTool is unavailable in this Chrome profile.',
  )

  const result = await page.evaluate(async () => {
    const abortController = new AbortController()
    let cleanupSignalObserved = false
    abortController.signal.addEventListener(
      'abort',
      () => {
        cleanupSignalObserved = true
      },
      { once: true },
    )
    const temporaryTool = {
      name: 'callscope_m1_feasibility_probe',
      description: 'Temporary isolated registration probe.',
      inputSchema: {
        type: 'object',
        properties: { nonce: { type: 'string' } },
        required: ['nonce'],
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      execute: async ({ nonce }) => ({ ok: true, echoed_nonce: nonce }),
    }
    document.modelContext.registerTool(temporaryTool, {
      signal: abortController.signal,
    })
    const invocation = await temporaryTool.execute({ nonce: 'synthetic-spike' })
    const annotations = structuredClone(temporaryTool.annotations)
    abortController.abort()

    return {
      invocation,
      annotations,
      topLevelDocument: window.top === window,
      cleanupSignalObserved,
      signalAborted: abortController.signal.aborted,
    }
  })

  expect(result.invocation).toEqual({ ok: true, echoed_nonce: 'synthetic-spike' })
  expect(result.annotations).toEqual({
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  })
  expect(result.topLevelDocument).toBe(true)
  expect(result.cleanupSignalObserved).toBe(true)
  expect(result.signalAborted).toBe(true)
})
