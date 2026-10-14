/**
 * The direct connection between two copies of the application (PRD §22.0): WebRTC, with a connection code traded by hand instead of a
 * server. One side makes an **invitation** (`openInvitation`), the other **answers** it (`answerInvitation`), and the answer is given back.
 * What comes out is a *channel*, the only thing the rest of the table knows about the network:
 *
 *   { send(text), close(), bufferedAmount, onmessage: (text) => void, onclose: () => void }
 *
 * On one network the two machines find each other by their own addresses. Across the internet each needs to learn the address its router
 * shows to the world, which a public STUN helper tells it: pass `iceServers: [{ urls: 'stun:…' }]`. It is only used while connecting, and
 * is off unless it is asked for (the application is offline first, PRD A74).
 */
import { packCode, unpackCode, LinkError } from './rtcCode.js'
import { tr } from '../../../shared/i18n.js'

const GATHER_MS = 4000          // how long to wait for the machine's addresses before the code is made with those found
const CONNECT_MS = 30000        // how long a connection may take once the answer is in

const waitForGathering = (pc, ms) => new Promise(resolve => {
  if (pc.iceGatheringState === 'complete') return resolve()
  const done = () => { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', check); resolve() }
  const check = () => { if (pc.iceGatheringState === 'complete') done() }
  const timer = setTimeout(done, ms)
  pc.addEventListener('icegatheringstatechange', check)
})

/** A channel over a data channel; `closed` goes off once, when the channel or the connection goes. */
function channelOf(pc, dc) {
  const channel = {
    onmessage: null,
    onclose: null,
    send: text => dc.send(text),
    close: () => { try { dc.close() } catch { /* already closed */ } try { pc.close() } catch { /* already closed */ } },
    get bufferedAmount() { return dc.bufferedAmount }
  }
  let closed = false
  const gone = () => { if (closed) return; closed = true; channel.onclose?.() }
  dc.onmessage = e => { if (typeof e.data === 'string') channel.onmessage?.(e.data) }
  dc.onclose = gone
  pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') gone() })
  return channel
}

/** A promise that the data channel opens, or fails after `ms`. */
const opens = (pc, dc, ms) => new Promise((resolve, reject) => {
  if (dc.readyState === 'open') return resolve()
  const timer = setTimeout(() => { try { pc.close() } catch { /* nothing to close */ } reject(new LinkError('timeout', tr('shareLink.timeout'))) }, ms)
  dc.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
  pc.addEventListener('connectionstatechange', () => { if (pc.connectionState === 'failed') { clearTimeout(timer); reject(new LinkError('failed', tr('shareLink.connectFailed'))) } })
})

const newConnection = (iceServers, RTC) => {
  if (typeof RTC.RTCPeerConnection !== 'function') throw new LinkError('noRtc', tr('shareLink.noRtc'))
  return new RTC.RTCPeerConnection({ iceServers })
}

/**
 * Make an invitation for one guest.
 * @returns {Promise<{ code: string, accept: (answerCode: string) => Promise<object>, cancel: () => void }>}
 *   `accept` takes the guest's answer and gives the channel once it is open.
 */
export async function openInvitation({ iceServers = [], gatherMs = GATHER_MS, connectMs = CONNECT_MS } = {}, RTC = globalThis) {
  const pc = newConnection(iceServers, RTC)
  const dc = pc.createDataChannel('spadewick', { ordered: true })
  await pc.setLocalDescription(await pc.createOffer())
  await waitForGathering(pc, gatherMs)
  const code = await packCode('offer', pc.localDescription.sdp)
  return {
    code,
    async accept(answerCode) {
      const { sdp } = await unpackCode(answerCode, 'answer')
      try { await pc.setRemoteDescription({ type: 'answer', sdp }) } catch { throw new LinkError('format', tr('shareLink.codeFormat')) }
      await opens(pc, dc, connectMs)
      return channelOf(pc, dc)
    },
    cancel() { try { pc.close() } catch { /* already closed */ } }
  }
}

/**
 * Answer an invitation.
 * @returns {Promise<{ code: string, connected: Promise<object>, cancel: () => void }>}
 *   `code` is the answer to give to the host; `connected` gives the channel once the host has it and the channel is open.
 */
export async function answerInvitation(offerCode, { iceServers = [], gatherMs = GATHER_MS, connectMs = CONNECT_MS } = {}, RTC = globalThis) {
  const { sdp } = await unpackCode(offerCode, 'offer')
  const pc = newConnection(iceServers, RTC)
  const channelReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { pc.close() } catch { /* nothing to close */ } reject(new LinkError('timeout', tr('shareLink.timeout'))) }, connectMs + gatherMs)
    pc.ondatachannel = async e => {
      try { await opens(pc, e.channel, connectMs); clearTimeout(timer); resolve(channelOf(pc, e.channel)) } catch (err) { clearTimeout(timer); reject(err) }
    }
  })
  channelReady.catch(() => { /* reported to whoever waits for `connected` */ })
  try {
    await pc.setRemoteDescription({ type: 'offer', sdp })
    await pc.setLocalDescription(await pc.createAnswer())
  } catch { try { pc.close() } catch { /* nothing to close */ } throw new LinkError('format', tr('shareLink.codeFormat')) }
  await waitForGathering(pc, gatherMs)
  return { code: await packCode('answer', pc.localDescription.sdp), connected: channelReady, cancel() { try { pc.close() } catch { /* already closed */ } } }
}
