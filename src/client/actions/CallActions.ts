import { GetAsyncAction, makeAction } from '../async'
import { DIAL, HANG_UP, SOCKET_EVENT_CREATE_ROOM, SOCKET_EVENT_USERS, SOCKET_EVENT_HANG_UP, SOCKET_EVENT_RECORD, CALL_RECORD, SOCKET_CONNECTED, SOCKET_DISCONNECTED } from '../constants'
import socket from '../socket'
import store, { ThunkResult } from '../store'
import { callId, userId } from '../window'
import * as NotifyActions from './NotifyActions'
import * as SocketActions from './SocketActions'

export interface ConnectedAction {
  type: 'SOCKET_CONNECTED'
}

const connected = (): ConnectedAction => ({
  type: SOCKET_CONNECTED,
})

export interface DisconnectedAction {
  type: 'SOCKET_DISCONNECTED'
}

const disconnected = (): DisconnectedAction => ({
  type: SOCKET_DISCONNECTED,
})

export const init = (): ThunkResult<Promise<void>> => async dispatch => {
  return new Promise(resolve => {
    socket.on('connect', () => {
      dispatch(NotifyActions.warning('Connected to server socket'))
      dispatch(connected())
      socket.emit(SOCKET_EVENT_CREATE_ROOM, { room: callId, userId })
      resolve()
    })
    socket.on('disconnect', () => {
      dispatch(NotifyActions.error('Server socket disconnected'))
      dispatch(disconnected())
    })
  })
}

export interface DialParams {
  nickname: string
}

export const dial = makeAction(
  DIAL,
  (params: DialParams) => new Promise<void>((resolve, reject) => {
    SocketActions.handshake({
      nickname: params.nickname,
      socket,
      roomName: callId,
      userId,
      store,
    })
    socket.once(SOCKET_EVENT_USERS, () => resolve())
    setTimeout(reject, 10000, new Error('Dial timed out!'))
  }),
)

export type HangUpAction = {
  type: 'HANG_UP'
}

export const hangUp = (): HangUpAction => {
  socket.emit(SOCKET_EVENT_HANG_UP, { userId })
  SocketActions.removeEventListeners(socket)
  return {
    type: HANG_UP,
  }
}

export interface CallRecordPayload {
  recordStatus: boolean
}

export type RecordAction = { 
  type: 'CALL_RECORD',
  payload: CallRecordPayload
}

export const recordAction = (recordStatus: boolean): RecordAction => {
  socket.emit(SOCKET_EVENT_RECORD, { recordStatus, userId })
  return {
    type: CALL_RECORD,
    payload: { recordStatus }
  }
}

export type DialAction = GetAsyncAction<ReturnType<typeof dial>>
