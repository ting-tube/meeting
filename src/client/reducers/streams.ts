import _debug from 'debug'
import forEach from 'lodash/forEach'
import keyBy from 'lodash/keyBy'
import omit from 'lodash/omit'
import { MetadataPayload, TrackMetadata } from '../SocketEvent'
import { HangUpAction } from '../actions/CallActions'
import { MediaTrackAction, MediaStreamAction, MediaTrackPayload } from '../actions/MediaActions'
import { NicknameRemoveAction, NicknameRemovePayload } from '../actions/NicknameActions'
import { RemovePeerAction } from '../actions/PeerActions'
import { iceServers } from '../window'
import Peer from 'simple-peer'


import {
  AddLocalStreamPayload,
  AddTrackPayload,
  RemoveLocalStreamPayload,
  StreamAction,
  StreamType,
  TracksMetadataAction,
  StreamTypeCamera,
} from '../actions/StreamActions'
import {
  HANG_UP,
  MEDIA_STREAM,
  NICKNAME_REMOVE,
  PEER_REMOVE,
  STREAM_REMOVE,
  STREAM_TRACK_ADD,
  STREAM_TRACK_REMOVE,
  TRACKS_METADATA,
  MEDIA_TRACK,
  PEER_DATA_CHANNEL_NAME,
  PEER_EVENT_ERROR,
  PEER_EVENT_CONNECT,
  PEER_EVENT_CLOSE,
  PEER_EVENT_SIGNAL,
  PEER_EVENT_TRACK,
  PEER_EVENT_DATA,
  STREAM_LOCAL_RECORD, STREAM_LOCAL_STOP_RECORD,
} from '../constants'
import { createObjectURL, MediaStream, revokeObjectURL } from '../window'

const debug = _debug('peercalls:streams')
const defaultState = Object.freeze({
  localStreams: {},
  streamsByUserId: {},
  metadataByPeerIdMid: {},
  trackIdToPeerIdMid: {},
  tracksByPeerIdMid: {},
  localRecorders: [],
  streamsRecordUrl: '',
  isRecording: false,
})

const peerIdMidSeparator = '::'

function getPeerIdMid(userId: string, mid: string): string {
  return userId + peerIdMidSeparator + mid
}

function safeCreateObjectURL(stream: MediaStream) {
  try {
    return createObjectURL(stream)
  } catch (err) {
    return undefined
  }
}

export interface StreamWithURL {
  stream: MediaStream
  streamId: string
  url?: string
}

export interface LocalStream extends StreamWithURL {
  type: StreamType
  mirror: boolean
}

export interface RoomRecord {
  userId: string
}

export interface UserStreams {
  userId: string
  streams: StreamWithURL[]
}

export interface StreamsState {
  localStreams: {
    [t in StreamType]?: LocalStream
  }
  streamsByUserId: Record<string, UserStreams>
  metadataByPeerIdMid: Record<string, TrackMetadata>
  trackIdToPeerIdMid: Record<string, string>
  tracksByPeerIdMid: Record<string, TrackInfo>
  localRecorders: [string][]
  streamsRecordUrl: string
  isRecording: boolean
}

export type StreamIdRecorder = [string]

interface TrackInfo {
  track: MediaStreamTrack
  mid: string
  association: TrackAssociation | undefined
}

interface TrackAssociation {
  streamId: string
  userId: string
}

interface MidWithUserId {
  mid: string
  streamId: string
  userId: string
}

interface StreamIdUserId {
  streamId: string
  userId: string
}

interface RecordLocalStreamPayload {
  recordUrl: string
  roomID: string
  userID: string
}

interface PeerInstanceInterface extends Peer.Instance {
  streams?: [MediaStream]
}

let peerInstance: PeerInstanceInterface
let isRecording = false

/*
 * getUserId returns the real user id from the metadata, if available, or
 * the userId for the peer. In a normal P2P mesh network, each user will
 * have their own peer, which will correspond to their own userId. In case of
 * an SFU, on peer connection from the server could provide tracks from
 * different users. That's why metadata is sent before each negotiation. The
 * metadata will contain a userId paired with mid (transceiver).
 */
function getUserId(
  state: StreamsState,
  payload: MidWithUserId,
): StreamIdUserId {
  const { mid } = payload
  const peerIdMid = getPeerIdMid(payload.userId, mid)
  const metadata = state.metadataByPeerIdMid[peerIdMid]

  if (metadata) {
    debug(
      'streams getUserId',
      payload.userId, payload.streamId, metadata.userId, metadata.streamId)
    return {
      userId: metadata.userId,
      streamId: metadata.streamId,
    }
  }

  debug('streams getUserId', payload.userId, payload.streamId)
  return {
    userId: payload.userId,
    streamId: payload.streamId,
  }
}

function addLocalStream(
  state: StreamsState, payload: AddLocalStreamPayload,
): StreamsState {
  const { localRecorders, streamsRecordUrl } = state
  const { stream } = payload
  debug('streams addLocalStream')
  const streamWithURL: LocalStream = {
    stream: payload.stream,
    streamId: payload.stream.id,
    type: payload.type,
    url: safeCreateObjectURL(stream),
    mirror: payload.type === StreamTypeCamera &&
      !!stream.getVideoTracks().find(t => !notMirroredRegexp.test(t.label)),
  }

  const existingStream = state.localStreams[payload.type]
  if (existingStream) {
    stopStream(existingStream)
  }

  if (state.isRecording) {
    localRecorders.push(recordAdditionalStream(streamWithURL, streamsRecordUrl))
  }

  return {
    ...state,
    localStreams: {
      ...state.localStreams,
      [payload.type]: streamWithURL,
    },
    localRecorders: localRecorders,
  }
}

function removeLocalStream(
  state: StreamsState, payload: RemoveLocalStreamPayload,
): StreamsState {
  let newLocalRecorders: StreamIdRecorder[] = []
  const { localStreams, localRecorders } = state
  const existing = localStreams[payload.streamType]

  if (!existing) {
    return state
  }

  if (state.isRecording) {
    newLocalRecorders = stopRecordAdditionalStream(localRecorders, existing)
  }

  return {
    ...state,
    localStreams: omit(localStreams, [payload.streamType]),
    localRecorders: newLocalRecorders,
  }
}

function removeTrack(
  state: StreamsState, track: MediaStreamTrack,
): StreamsState {
  debug('streams removeTrack: %o', track.id)
  const peerIdMid = state.trackIdToPeerIdMid[track.id]
  const t = state.tracksByPeerIdMid[peerIdMid]

  if (!t) {
    debug('streams removeTrack trackInfo not found', peerIdMid)
    return state
  }
  const { association } = t
  if (!association) {
    debug('streams removeTrack track not associated')
    return state
  }
  const { userId, streamId } = association
  debug('streams removeTrack userId: %s, streamId: %s', userId, streamId)

  const userStreams = state.streamsByUserId[userId]
  if (!userStreams) {
    debug('streams removeTrack user streams not found')
    return state
  }

  let streams = userStreams.streams
  const s = streams.find(s => s.streamId === streamId)

  if (!s) {
    debug('streams removeTrack track stream not found', streamId)
    return state
  }

  debug('stream removeTrack: before tracks', s.stream.getTracks().length)
  s.stream.removeTrack(track)
  debug('stream removeTrack: after tracks', s.stream.getTracks().length)
  if (s.stream.getTracks().length === 0) {
    s.url && revokeObjectURL(s.url)
    streams = streams.filter(_s => _s !== s)
  }

  const tracksByPeerIdMid = {
    ...state.tracksByPeerIdMid,
    [peerIdMid]: {
      track,
      mid: t.mid,
      association: undefined,
    },
  }

  if (streams.length > 0) {
    return {
      ...state,
      streamsByUserId: {
        ...state.streamsByUserId,
        [userId]: {
          ...userStreams,
          streams,
        },
      },
      tracksByPeerIdMid,
    }
  }

  debug('streams removeTrack removing user entry since no streams left')
  return {
    ...state,
    streamsByUserId: omit(state.streamsByUserId, [userId]),
    tracksByPeerIdMid,
  }
}

function recordLocalStream(
  state: StreamsState, payload: RecordLocalStreamPayload,
): StreamsState {
  debug('streams recordLocalTracks: %o', payload)
  const mediaRecorders = Object.entries(state.localStreams)
    .map(([type, stream]) => {
      return initializeMediaRecorder(
        payload.roomID,
        payload.userID,
        stream!.stream,
      )
    },
    )

  isRecording = true

  return {
    ...state,
    localRecorders: mediaRecorders,
    streamsRecordUrl: payload.recordUrl,
    isRecording: !state.isRecording,
  }
}

function recordAdditionalStream(
  localStream: LocalStream, streamsRecordUrl: string,
): StreamIdRecorder {
  // const streamRecordUrl = `${streamsRecordUrl}/${localStream.type}`
  return initializeMediaRecorder('', '', localStream.stream)
}

function initializePeer(roomID: string, userID: string, stream: MediaStream) {
  const peer = new Peer(({
    initiator: true,
    iceCompleteTimeout: 1200000,
    config: {
      iceServers,
      enableInsertableStreams: true,
      // legacy flags for insertable streams
      forceEncodedVideoInsertableStreams: true,
      forceEncodedAudioInsertableStreams: true,
    },
    // channelName: PEER_DATA_CHANNEL_NAME,
    // trickle: false,
    // Allow the peer to receive video, even if it's not sending stream:
    // https://github.com/feross/simple-peer/issues/95
    offerConstraints: {
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    },
    stream,
  } as any))

  peer.once(PEER_EVENT_ERROR, (err: Error) => {
    debug('peer record error', err)
  })
  peer.once(PEER_EVENT_CONNECT, () => {
    debug('peer record connect')
  })
  peer.once(PEER_EVENT_CLOSE, () => {
    debug('peer record CLOSE')
    if (isRecording) {
      // peerInstance = initializePeer(roomID, userID, stream)
    }
  })
  peer.once(PEER_EVENT_SIGNAL, (data) => {
    if (data != null) {
      fetch('/api/sessions/' + roomID + '/join/' + userID, {
        method: 'POST',
        body: btoa(JSON.stringify(data)),
      }).then((resp) => {
        resp.json().then(data => {
          try {
            peer.signal(data)
          } catch (e) {
            debug(e)
          }
        })
      })
    }
    debug('peer record signal', data)
  })
  peer.on(PEER_EVENT_TRACK, (track, stream) => {
    debug('peer record track', track, stream)
  })
  peer.on(PEER_EVENT_DATA, (data) => {
    debug('peer record data', data)
  })

  return peer
}

function initializeMediaRecorder(
  roomID: string, userID: string, stream: MediaStream,
): StreamIdRecorder {

  if (!roomID && !userID) {
    const isStreamExists = peerInstance.streams!.find(
      (streamData: MediaStream) => streamData.id === stream.id)
    if (!isStreamExists) {
      peerInstance.addStream(stream)
    }
  } else {
    peerInstance = initializePeer(roomID, userID, stream)
  }

  return [stream.id]
}

function stopRecordLocalStream(
  state: StreamsState,
): StreamsState {

  peerInstance?.destroy()
  isRecording = false

  return {
    ...state,
    isRecording: !state.isRecording,
  }
}

function stopRecordAdditionalStream(
  localRecorders: [string][], localStream: LocalStream,
): StreamIdRecorder[] {
  const newLocalRecorders: StreamIdRecorder[] = []

  peerInstance.removeStream(localStream.stream)

  for (let i = 0; i < localRecorders.length; i += 1) {
    const currentRecorderWithStreamId = localRecorders[i]
    if (localStream.streamId === currentRecorderWithStreamId[0]) {
      // peerInstance?.destroy()
    } else {
      newLocalRecorders.push(currentRecorderWithStreamId)
    }
  }

  return newLocalRecorders
}

function addTrack(
  state: StreamsState, payload: AddTrackPayload,
): StreamsState {
  debug('streams addTrack: %o', payload)
  const peerIdMid = getPeerIdMid(payload.userId, payload.mid)
  const { userId, streamId } = getUserId(state, payload)
  const { track } = payload

  const userStreams = state.streamsByUserId[userId] || {
    streams: [],
    userId,
  }

  const streams: StreamWithURL[] = userStreams.streams
  const existing = streams.find(s => s.streamId === streamId)

  if (existing) {
    debug('streams addTrack to existing stream')
    existing.stream.addTrack(track)
  } else {
    debug('streams addTrack to new stream')
    const stream = new MediaStream()
    stream.addTrack(track)
    streams.push({
      stream,
      streamId,
      url: safeCreateObjectURL(stream),
    })
  }

  return {
    ...state,
    streamsByUserId: {
      ...state.streamsByUserId,
      [userId]: {
        ...userStreams,
        streams: [...streams],
      },
    },
    trackIdToPeerIdMid: {
      ...state.trackIdToPeerIdMid,
      [track.id]: peerIdMid,
    },
    tracksByPeerIdMid: {
      ...state.tracksByPeerIdMid,
      [peerIdMid]: {
        track,
        mid: payload.mid,
        association: {
          streamId,
          userId,
        },
      },
    },
  }
}

export function unassociateUserTracks(
  state: StreamsState,
  payload: NicknameRemovePayload,
): StreamsState {
  debug('streams unassociateUserTracks')
  const { userId } = payload

  const userStreams = state.streamsByUserId[userId]
  if (!userStreams) {
    debug('streams unassociateUserTracks: user not found')
    return state
  }

  const tracksByPeerIdMid: Record<string, TrackInfo> = {}

  userStreams.streams.forEach(s => {
    s.stream.getTracks().forEach(track => {
      const peerIdMid = state.trackIdToPeerIdMid[track.id]
      tracksByPeerIdMid[peerIdMid] = {
        track,
        mid: state.tracksByPeerIdMid[peerIdMid].mid,
        association: undefined,
      }
      s.stream.removeTrack(track)
    })
  })

  const streamsByUserId = omit(state.streamsByUserId, [userId])

  return {
    ...state,
    streamsByUserId,
    tracksByPeerIdMid: {
      ...state.tracksByPeerIdMid,
      ...tracksByPeerIdMid,
    },
  }
}

function stopStream(s: StreamWithURL) {
  debug('streams stopStream()')
  s.stream.getTracks().forEach(track => {
    track.stop()
    track.onmute = null
    track.onunmute = null
  })
  s.url && revokeObjectURL(s.url)
}

function stopAllTracks(streams: StreamWithURL[]) {
  debug('streams stopAllTracks()')
  streams.forEach(s => stopStream(s))
}

function setMetadata(
  state: StreamsState,
  payload: MetadataPayload,
): StreamsState {
  debug('streams setMetadata: %o', payload)
  let newState = state
  const metadataByPeerIdMid = keyBy(
    payload.metadata,
    m => getPeerIdMid(payload.userId, m.mid),
  )

  forEach(state.tracksByPeerIdMid, (t, peerIdMid) => {
    if (!metadataByPeerIdMid[peerIdMid] && t && t.association) {
      // remove any track the server has lost track of
      newState = removeTrack(newState, t.track)
    }
  })

  newState = {
    ...newState,
    metadataByPeerIdMid,
  }

  payload.metadata.forEach(m => {
    const { streamId, mid, userId } = m
    const peerIdMid = getPeerIdMid(payload.userId, mid)
    const t = state.tracksByPeerIdMid[peerIdMid]

    if (!t) {
      // this track hasn't been seen yet so there's nothing to do
      return
    }

    if (!t.association) {
      // add the unassociated track
      newState = addTrack(newState, {
        mid,
        streamId,
        track: t.track,
        userId: payload.userId,
      })
      return
    }

    const a = t.association
    if (a.streamId === streamId && a.userId === userId) {
      // track is associated with the right userId / streamId
      return
    }

    newState = removeTrack(newState, t.track)
    newState = addTrack(newState, {
      mid,
      streamId: a.streamId,
      track: t.track,
      userId: payload.userId,
    })
  })

  return newState
}

function removePeer(
  state: StreamsState,
  payload: RemovePeerAction['payload'],
): StreamsState {
  debug('streams removePeer: %o', payload)
  let newState: StreamsState = state

  const keysToRemove = Object.keys(state.tracksByPeerIdMid)
    .filter(key => key.startsWith(payload.userId + peerIdMidSeparator))

  const trackIdToPeerIdMid = state.trackIdToPeerIdMid

  keysToRemove.forEach(key => {
    const t = state.tracksByPeerIdMid[key]
    if (t.association) {
      newState = removeTrack(newState, t.track)
    }
    delete trackIdToPeerIdMid[t.track.id]
  })

  const tracksByPeerIdMid = omit(state.tracksByPeerIdMid, keysToRemove)

  return {
    ...newState,
    trackIdToPeerIdMid: { ...trackIdToPeerIdMid },
    tracksByPeerIdMid,
  }
}

const notMirroredRegexp = /back/i

function setLocalStreamMirror(
  state: StreamsState,
  payload: MediaTrackPayload,
): StreamsState {
  const { track, type } = payload
  const existingStream = state.localStreams[type]

  if (
    track &&
    track.kind === 'video' &&
    type === StreamTypeCamera &&
    existingStream
  ) {
    return {
      ...state,
      localStreams: {
        ...state.localStreams,
        [type]: {
          ...existingStream,
          mirror: !notMirroredRegexp.test(track.label),
        },
      },
    }
  }

  return state
}

export default function streams(
  state: StreamsState = defaultState,
  action:
    StreamAction |
    MediaStreamAction |
    MediaTrackAction |
    HangUpAction |
    NicknameRemoveAction |
    RemovePeerAction |
    TracksMetadataAction,
): StreamsState {
  switch (action.type) {
    case STREAM_REMOVE:
      return removeLocalStream(state, action.payload)
    case STREAM_TRACK_ADD:
      return addTrack(state, action.payload)
    case STREAM_TRACK_REMOVE:
      return removeTrack(state, action.payload.track)
    case STREAM_LOCAL_RECORD:
      return recordLocalStream(state, action.payload)
    case STREAM_LOCAL_STOP_RECORD:
      return stopRecordLocalStream(state)
    case NICKNAME_REMOVE:
      return unassociateUserTracks(state, action.payload)
    case TRACKS_METADATA:
      return setMetadata(state, action.payload)
    case PEER_REMOVE:
      return removePeer(state, action.payload)
    case HANG_UP:
      peerInstance?.destroy()
      forEach(state.localStreams, ls => stopStream(ls!))
      forEach(state.streamsByUserId, us => stopAllTracks(us.streams))
      return defaultState
    case MEDIA_STREAM:
      if (action.status === 'resolved') {
        return addLocalStream(state, action.payload)
      } else {
        return state
      }
    case MEDIA_TRACK:
      if (action.status === 'resolved') {
        return setLocalStreamMirror(state, action.payload)
      } else {
        return state
      }
    default:
      return state
  }
}
