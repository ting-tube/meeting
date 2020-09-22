import { SignalData } from 'simple-peer'

export interface Ready {
  room: string
  userId: string
  nickname: string
}

export interface TrackMetadata {
  mid: string
  kind: string
  userId: string
  streamId: string
}

export interface MetadataPayload {
  userId: string
  metadata: TrackMetadata[]
}

export interface SocketEvent {
  users: {
    initiator: string
    // peers to connect to
    peerIds: string[]
    // mapping of userId / nickname
    nicknames: Record<string, string>
    recordStatus: boolean
    recordUrl: string
  }
  metadata: MetadataPayload
  hangUp: {
    userId: string
  }
  record: {
    recordStatus: boolean
  }
  record_callback: {
    successful: boolean
    recordStatus: boolean
    url: string
  }
  signal: {
    userId: string
    // eslint-disable-next-line
    signal: SignalData
  }
  create_room: {
    room: string
    userId: string
  }
  room_created: {
    creatorId: string
  }
  connect: undefined
  disconnect: undefined
  ready: Ready
}

export interface RecordingSocket {
  record: Blob
  record_stop: {}
}
