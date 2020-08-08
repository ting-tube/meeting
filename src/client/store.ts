import { Action, applyMiddleware, createStore as _createStore, Store as ReduxStore, compose } from 'redux'
import { ThunkAction, ThunkDispatch } from 'redux-thunk'
import { create } from './middlewares'
import reducers from './reducers'

export const middlewares = create(
  window.localStorage && window.localStorage.log,
)


declare global {
  interface Window {
    __REDUX_DEVTOOLS_EXTENSION_COMPOSE__?: typeof compose
  }
}
const composeEnhancers = typeof window === 'object' &&
  window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__
    ? window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__
    : compose
export const createStore = () => _createStore(
  reducers,
  composeEnhancers(applyMiddleware(...middlewares)),
)

export default createStore()

export type Store = ReturnType<typeof createStore>

type TGetState<T> = T extends ReduxStore<infer State> ? State : never
export type State = TGetState<Store>
export type GetState = () => State

export type Dispatch = ThunkDispatch<State, undefined, Action>
export type ThunkResult<R> = ThunkAction<R, State, undefined, Action>
