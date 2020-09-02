import classnames from 'classnames'
import React from 'react'
import { MdCallEnd, MdShare, MdContentCopy, MdFullscreen, MdFullscreenExit, MdQuestionAnswer, MdScreenShare, MdStopScreenShare, MdRadioButtonUnchecked, MdRadioButtonChecked } from 'react-icons/md'
import screenfull from 'screenfull'
import { getDesktopStream } from '../actions/MediaActions'
import { removeLocalStream } from '../actions/StreamActions'
import { DialState, DIAL_STATE_IN_CALL } from '../constants'
import { LocalStream } from '../reducers/streams'
import { callId } from '../window'
import { AudioDropdown, VideoDropdown } from './DeviceDropdown'
import { ToolbarButton } from './ToolbarButton'

export interface ToolbarProps {
  dialState: DialState
  nickname: string
  messagesCount: number
  desktopStream: LocalStream | undefined
  recordStatus: boolean
  onToggleChat: () => void
  onToggleRecord: () => void
  onGetDesktopStream: typeof getDesktopStream
  onRemoveLocalStream: typeof removeLocalStream
  onHangup: () => void
  chatVisible: boolean
}

export interface ToolbarState {
  hidden: boolean
  readMessages: number
  camDisabled: boolean
  micMuted: boolean
  fullScreenEnabled: boolean
}

interface ShareData {
  title: string
  text: string
  url: string
}

interface ShareNavigator extends Navigator {
  share: (data: ShareData) => Promise<void>
}

function canShare(navigator: Navigator): navigator is ShareNavigator {
  return 'share' in navigator
}

export default class Toolbar extends React.PureComponent<
  ToolbarProps,
  ToolbarState
> {

  constructor(props: ToolbarProps) {
    super(props)
    this.state = {
      hidden: false,
      readMessages: props.messagesCount,
      camDisabled: false,
      micMuted: false,
      fullScreenEnabled: false,
    }
  }
  componentDidMount() {
    document.body.addEventListener('click', this.toggleHidden)
    screenfull.isEnabled && screenfull.on('change', this.fullscreenChange)
  }
  componentDidWillUnmount() {
    document.body.removeEventListener('click', this.toggleHidden)
    screenfull.isEnabled && screenfull.off('change', this.fullscreenChange)
  }
  fullscreenChange = () => {
    this.setState({
      fullScreenEnabled: screenfull.isEnabled && screenfull.isFullscreen,
    })
  }
  toggleHidden = (e: MouseEvent) => {
    const t = e.target && (e.target as HTMLElement).tagName

    if (t === 'DIV' || t === 'VIDEO') {
      this.setState({ hidden: !this.state.hidden })
    }
  }
  handleFullscreenClick = () => {
    if (screenfull.isEnabled) {
      screenfull.toggle()
    }
  }
  handleHangoutClick = () => {
    window.location.href = '/'
  }
  copyInvitationURL = async () => {
    const { nickname } = this.props
    const link = location.href
    const text = `${nickname} has invited you to a meeting on MeeTiNG`
    if (canShare(navigator)) {
      await navigator.share({
        title: 'MeeTiNG',
        text,
        url: link,
      })
      return
    }
    const value = `${text}. \nRoom: ${callId} \nLink: ${link}`
    await navigator.clipboard.writeText(value)
  }
  handleToggleChat = () => {
    this.setState({
      readMessages: this.props.messagesCount,
    })
    this.props.onToggleChat()
  }
  handleToggleShareDesktop = () => {
    if (this.props.desktopStream) {
      const { stream, type } = this.props.desktopStream
      this.props.onRemoveLocalStream(stream, type)
    } else {
      this.props.onGetDesktopStream().catch(() => {})
    }
  }
  render() {
    const {
      messagesCount,
      recordStatus,
      onToggleRecord,
      onHangup,
      chatVisible,
      desktopStream,
    } = this.props
    const unreadCount = messagesCount - this.state.readMessages
    const hasUnread = unreadCount > 0
    const isInCall = this.props.dialState === DIAL_STATE_IN_CALL

    const className = classnames('toolbar', {
      'toolbar-hidden': this.props.chatVisible || this.state.hidden,
    })

    return (
      <React.Fragment>
        <div className={'toolbar-other ' + className}>
          <ToolbarButton
            className='copy-url'
            key='copy-url'
            icon={canShare(navigator) ? MdShare : MdContentCopy}
            onClick={this.copyInvitationURL}
            title={canShare(navigator) ? 'Share' : 'Copy Invitation URL'}
          />
          {isInCall && (
            <ToolbarButton
              badge={unreadCount}
              className='chat'
              key='chat'
              icon={MdQuestionAnswer}
              blink={!chatVisible && hasUnread}
              onClick={this.handleToggleChat}
              on={chatVisible}
              title='Toggle Chat'
            />
          )}
        </div>

        {isInCall && (
          <div className={'toolbar-call ' + className}>
            <ToolbarButton
              className='stream-desktop'
              icon={MdStopScreenShare}
              offIcon={MdScreenShare}
              onClick={this.handleToggleShareDesktop}
              on={!!desktopStream}
              key='stream-desktop'
              title='Share Desktop'
            />

            <VideoDropdown />

            <ToolbarButton
              className='recording'
              icon={MdRadioButtonUnchecked}
              offIcon={MdRadioButtonChecked}
              onClick={onToggleRecord}
              on={recordStatus}
              key='recording'
              title='Start Recording'
            />

            <ToolbarButton
              onClick={onHangup}
              key='hangup'
              className='hangup'
              icon={MdCallEnd}
              title='Hang Up'
            />

            <AudioDropdown />

            <ToolbarButton
              onClick={this.handleFullscreenClick}
              className='fullscreen'
              key='fullscreen'
              icon={MdFullscreenExit}
              offIcon={MdFullscreen}
              on={this.state.fullScreenEnabled}
              title='Toggle Fullscreen'
            />

          </div>
        )}
      </React.Fragment>
    )
  }
}
