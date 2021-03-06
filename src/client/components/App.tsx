import classnames from 'classnames'
import forEach from 'lodash/forEach'
import React from 'react'
import Peer from 'simple-peer'
import { hangUp, recordAction } from '../actions/CallActions'
import { getDesktopStream } from '../actions/MediaActions'
import { dismissNotification, Notification } from '../actions/NotifyActions'
import { MinimizeTogglePayload, removeLocalStream, StreamTypeDesktop } from '../actions/StreamActions'
import * as constants from '../constants'
import { Message } from '../reducers/messages'
import { Nicknames } from '../reducers/nicknames'
import { StreamsState } from '../reducers/streams'
import { WindowStates } from '../reducers/windowStates'
import Chat from './Chat'
import { Media } from './Media'
import Notifications from './Notifications'
import Toolbar from './Toolbar'
import Videos from './Videos'
import socket from '../socket'
import {SOCKET_EVENT_RECORD} from '../constants'

export interface AppProps {
  dialState: constants.DialState
  dismissNotification: typeof dismissNotification
  init: () => void
  nicknames: Nicknames
  notifications: Record<string, Notification>
  messages: Message[]
  messagesCount: number
  peers: Record<string, Peer.Instance>
  play: () => void
  sendText: (message: string) => void
  streams: StreamsState
  getDesktopStream: typeof getDesktopStream
  removeLocalStream: typeof removeLocalStream
  sendFile: (file: File) => void
  windowStates: WindowStates
  minimizeToggle: (payload: MinimizeTogglePayload) => void
  hangUp: typeof hangUp
  recordAction: typeof recordAction
  recordStatus: boolean
}

export interface AppState {
  chatVisible: boolean
}

export default class App extends React.PureComponent<AppProps, AppState> {
  state: AppState = {
    chatVisible: false,
  }
  handleShowChat = () => {
    this.setState({
      chatVisible: true,
    })
  }
  handleHideChat = () => {
    this.setState({
      chatVisible: false,
    })
  }
  handleToggleChat = () => {
    return this.state.chatVisible
      ? this.handleHideChat()
      : this.handleShowChat()
  }
  handleToggleRecord = (): void => {
    const { recordStatus } = this.props
    socket.emit(SOCKET_EVENT_RECORD, { recordStatus: !recordStatus })
  }
  componentDidMount () {
    const { init } = this.props
    init()
  }
  onHangup = () => {
    const { localStreams } = this.props.streams
    forEach(localStreams, s => {
      this.props.removeLocalStream(s!.stream, s!.type)
    })
    this.props.hangUp()
  }
  render () {
    const {
      dismissNotification,
      notifications,
      nicknames,
      messages,
      messagesCount,
      sendFile,
      sendText,
      recordStatus,
    } = this.props

    const { chatVisible } = this.state

    const chatVisibleClassName = classnames({
      'chat-visible': chatVisible,
    })

    const { localStreams } = this.props.streams

    return (
      <div className="app">
        <Toolbar
          chatVisible={chatVisible}
          dialState={this.props.dialState}
          messagesCount={messagesCount}
          nickname={nicknames[constants.ME]}
          onToggleChat={this.handleToggleChat}
          recordStatus={recordStatus}
          onToggleRecord={this.handleToggleRecord}
          onHangup={this.onHangup}
          desktopStream={localStreams[StreamTypeDesktop]}
          onGetDesktopStream={this.props.getDesktopStream}
          onRemoveLocalStream={this.props.removeLocalStream}
        />
        <Notifications
          className={chatVisibleClassName}
          dismiss={dismissNotification}
          notifications={notifications}
        />
        <Chat
          messages={messages}
          nicknames={nicknames}
          onClose={this.handleHideChat}
          sendText={sendText}
          sendFile={sendFile}
          visible={chatVisible}
        />
        <Media />
        {this.props.dialState !== constants.DIAL_STATE_HUNG_UP &&
          <Videos
            onMinimizeToggle={this.props.minimizeToggle}
            streams={this.props.streams}
            play={this.props.play}
            nicknames={this.props.nicknames}
            windowStates={this.props.windowStates}
          />
        }
      </div>
    )
  }
}
