package server

import (
	"encoding/json"
	"html/template"
	"net/http"
	"net/url"
	"path"
	"strings"
	"sync"

	"github.com/go-chi/chi"
	"github.com/gobuffalo/packr"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type Mux struct {
	BaseURL     string
	handler     *chi.Mux
	iceServers  []ICEServer
	network     NetworkConfig
	version     string
	activeRooms *sync.Map
}

func (mux *Mux) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	mux.handler.ServeHTTP(w, r)
}

type TracksManager interface {
	Add(room string, transport *WebRTCTransport)
	GetTracksMetadata(room string, clientID string) ([]TrackMetadata, bool)
}

func withGauge(counter prometheus.Counter, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		counter.Inc()
		h.ServeHTTP(w, r)
	}
}

type RoomManager interface {
	Enter(room string) Adapter
	Exit(room string)
}

type ActiveRoom struct {
	creatorId       string
	recordingStatus bool
}

func NewMux(
	loggerFactory LoggerFactory,
	baseURL string,
	version string,
	network NetworkConfig,
	iceServers []ICEServer,
	rooms RoomManager,
	tracks TracksManager,
	prom PrometheusConfig,
	recordServiceURL string,
) *Mux {

	handler := chi.NewRouter()
	mux := &Mux{
		BaseURL:     baseURL,
		handler:     handler,
		iceServers:  iceServers,
		network:     network,
		version:     version,
		activeRooms: &sync.Map{},
	}

	var root string
	if baseURL == "" {
		root = "/"
	} else {
		root = baseURL
	}

	wsHandler := newWebSocketHandler(
		loggerFactory,
		network,
		NewWSS(loggerFactory, rooms),
		iceServers,
		tracks,
		mux.activeRooms,
		recordServiceURL,
	)

	handler.Route(root, func(router chi.Router) {
		router.Post("/call", withGauge(prometheusCallJoinTotal, mux.routeNewCall))
		router.Get("/probes/liveness", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
		})
		router.Get("/probes/health", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
		})
		router.Get("/metrics", func(w http.ResponseWriter, r *http.Request) {
			accessToken := r.Header.Get("Authorization")
			if strings.HasPrefix(accessToken, "Bearer ") {
				accessToken = accessToken[len("Bearer "):]
			} else {
				accessToken = r.FormValue("access_token")
			}

			if accessToken == "" || accessToken != prom.AccessToken {
				w.WriteHeader(401)
				return
			}
			promhttp.Handler().ServeHTTP(w, r)
		})

		serveIndexHtml := func(w http.ResponseWriter, r *http.Request) {
			http.ServeFile(w, r, "build/index.html")
		}
		router.Handle("/*", CustomFileServer(http.Dir("./build"), serveIndexHtml))
		router.Mount("/ws", wsHandler)
	})

	return mux
}

func newWebSocketHandler(loggerFactory LoggerFactory, network NetworkConfig, wss *WSS, iceServers []ICEServer, tracks TracksManager, activeRooms *sync.Map, recordServiceURL string) http.Handler {
	log := loggerFactory.GetLogger("mux")
	switch network.Type {
	case NetworkTypeSFU:
		log.Println("Using network type sfu")
		return NewSFUHandler(loggerFactory, wss, iceServers, network.SFU, tracks)
	default:
		log.Println("Using network type mesh")
		return NewMeshHandler(loggerFactory, wss, activeRooms, recordServiceURL)
	}
}

func static(prefix string, box packr.Box) http.Handler {
	fileServer := http.FileServer(http.FileSystem(box))
	return http.StripPrefix(prefix, fileServer)
}

func (mux *Mux) routeNewCall(w http.ResponseWriter, r *http.Request) {
	callID := r.PostFormValue("call")
	if callID == "" {
		callID = NewUUIDBase62()
	}
	url := mux.BaseURL + "/call/" + url.PathEscape(callID)
	http.Redirect(w, r, url, 302)
}

func (mux *Mux) routeIndex(w http.ResponseWriter, r *http.Request) (string, interface{}, error) {
	return "index.html", nil, nil
}

func (mux *Mux) routeCall(w http.ResponseWriter, r *http.Request) (string, interface{}, error) {
	callID := url.PathEscape(path.Base(r.URL.Path))
	userID := NewUUIDBase62()
	_, err := JWTTokenFromCookie(r)
	if err != nil {
		CreateTokenCookie(w)
	}

	iceServers := GetICEAuthServers(mux.iceServers)
	iceServersJSON, _ := json.Marshal(iceServers)
	data := map[string]interface{}{
		"Nickname":   r.Header.Get("X-Forwarded-User"),
		"CallID":     callID,
		"UserID":     userID,
		"ICEServers": template.HTML(iceServersJSON),
		"Network":    mux.network.Type,
		"Version":    mux.version,
	}
	return "call.html", data, nil
}
