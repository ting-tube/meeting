import classnames from 'classnames'
import React from 'react'
import {
  MdCallEnd,
  MdShare,
  MdContentCopy,
  MdFullscreen,
  MdFullscreenExit,
  MdQuestionAnswer,
  MdScreenShare,
  MdStopScreenShare,
  MdLock,
  MdLockOpen,
  MdWarning,
  MdRadioButtonChecked,
  MdRadioButtonUnchecked,
} from 'react-icons/md'
import CSSTransition from 'react-transition-group/CSSTransition'
import TransitionGroup from 'react-transition-group/TransitionGroup'
import screenfull from 'screenfull'
import { getDesktopStream } from '../actions/MediaActions'
import { removeLocalStream } from '../actions/StreamActions'
import { DialState, DIAL_STATE_IN_CALL } from '../constants'
import { LocalStream } from '../reducers/streams'
import { callId } from '../window'
import { AudioDropdown, VideoDropdown } from './DeviceDropdown'
import { ToolbarButton } from './ToolbarButton'
import { insertableStreamsCodec } from '../insertable-streams'
import { getBrowserFeatures } from '../features'

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
  encryptionDialogVisible: boolean
  encrypted: boolean
  copiedToastStatus: boolean
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
  encryptionKeyInputRef: React.RefObject<HTMLInputElement>
  supportsInsertableStreams: boolean

  constructor(props: ToolbarProps) {
    super(props)
    this.state = {
      hidden: false,
      readMessages: props.messagesCount,
      camDisabled: false,
      micMuted: false,
      fullScreenEnabled: false,
      encryptionDialogVisible: false,
      encrypted: false,
      copiedToastStatus: false,
    }
    this.encryptionKeyInputRef = React.createRef<HTMLInputElement>()
    this.supportsInsertableStreams = getBrowserFeatures().insertableStreams
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
  toggleEncryptionDialog = () => {
    const encryptionDialogVisible = !this.state.encryptionDialogVisible

    this.setState({
      encryptionDialogVisible,
    })

    const inputElement = this.encryptionKeyInputRef.current!

    if (encryptionDialogVisible) {
      setTimeout(() => {
        inputElement.focus()
      })
    }
  }
  setPasswordOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key == 'Enter') {
      this.setPassword()
    }
  }
  setPassword = () => {
    const inputElement = this.encryptionKeyInputRef.current!
    const key = inputElement.value
    inputElement.value = ''

    const encrypted =
      insertableStreamsCodec.setPassword(key) &&
      key.length > 0

    this.setState({
      encryptionDialogVisible: false,
      encrypted,
    })
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
  handleToggleRecord = () => {
    const {onToggleRecord, recordStatus} = this.props
    onToggleRecord()
    if (!recordStatus) {
      this.setState({
        copiedToastStatus: true,
      }, () => {
        setTimeout(() => {
          this.setState({
            copiedToastStatus: false,
          })
        }, 2500)
      })
    }
  }
  render() {
    const {
      messagesCount,
      recordStatus,
      onHangup,
      desktopStream,
    } = this.props
    const unreadCount = messagesCount - this.state.readMessages
    const hasUnread = unreadCount > 0
    const isInCall = this.props.dialState === DIAL_STATE_IN_CALL

    const className = classnames('toolbar', {
      'toolbar-hidden': this.props.chatVisible || this.state.hidden,
    })
    const encryptionIcon = this.state.encrypted
      ? MdLock
      : MdLockOpen

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
            <React.Fragment>
              <ToolbarButton
                badge={unreadCount}
                className='chat'
                key='chat'
                icon={MdQuestionAnswer}
                blink={!this.props.chatVisible && hasUnread}
                onClick={this.handleToggleChat}
                on={this.props.chatVisible}
                title='Toggle Chat'
              />
            </React.Fragment>
          )}

          <div className='encryption-wrapper'>
            <ToolbarButton
              onClick={this.toggleEncryptionDialog}
              key='encryption'
              className={classnames('encryption', {
                'encryption-enabled': this.state.encrypted,
              })}
              on={this.state.encryptionDialogVisible || this.state.encrypted}
              icon={encryptionIcon}
              title='Setup Encryption'
            />
            <div
              className={classnames('encryption-dialog', {
                'encryption-dialog-visible': this.state.encryptionDialogVisible,
              })}
            >
              <div className='encryption-form'>
                <input
                  autoComplete='off'
                  name='encryption-key'
                  className='encryption-key'
                  placeholder='Enter Passphrase'
                  ref={this.encryptionKeyInputRef}
                  type='password'
                  onKeyUp={this.setPasswordOnEnter}
                />
                <button onClick={this.setPassword}>Save</button>
              </div>
              <div className='note'>
                <p><MdWarning /> Experimental functionality for A/V only.</p>
                {!this.supportsInsertableStreams && (
                  <p>
                    Your browser does not support Insertable Streams;
                    currently only Chrome has support. If you are using Chrome,
                    please make sure Experimental Web Platform Features are
                    enabled in chrome://flags.
                  </p>
                )} </div>
            </div>
          </div>
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

            <TransitionGroup>
              {this.state.copiedToastStatus && (
                <CSSTransition classNames='fade' timeout={{
                  enter: 200,
                  exit: 100,
                }}>
                  <span className="copied-toast">Copied!</span>
                </CSSTransition>
              )}
            </TransitionGroup>

            <ToolbarButton
              className='recording'
              icon={MdRadioButtonUnchecked}
              offIcon={MdRadioButtonChecked}
              onClick={this.handleToggleRecord}
              on={recordStatus}
              key='recording'
              title={!recordStatus ? 'Start Recording' : 'Stop Recording'}
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
