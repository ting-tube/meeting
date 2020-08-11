package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"crypto/tls"
)

type ReadyMessage struct {
	UserID string `json:"userId"`
	Room   string `json:"room"`
}

func NewMeshHandler(loggerFactory LoggerFactory, wss *WSS) http.Handler {
	log := loggerFactory.GetLogger("mesh")

	fn := func(w http.ResponseWriter, r *http.Request) {
		sub, err := wss.Subscribe(w, r)
		if err != nil {
			log.Printf("Error subscribing to websocket messages: %s", err)
		}
		for msg := range sub.Messages {
			adapter := sub.Adapter
			room := sub.Room
			clientID := sub.ClientID

			var responseEventName string
			var err error

			switch msg.Type {
			case "hangUp":
				log.Printf("[%s] hangUp event", clientID)
				adapter.SetMetadata(clientID, "")
			case "ready":
				// FIXME check for errors
				payload, _ := msg.Payload.(map[string]interface{})
				adapter.SetMetadata(clientID, payload["nickname"].(string))

				clients, readyClientsErr := getReadyClients(adapter)
				if readyClientsErr != nil {
					log.Printf("Error retrieving clients: %s", readyClientsErr)
				}
				responseEventName = "users"
				log.Printf("Got clients: %s", clients)
				err = adapter.Broadcast(
					NewMessage(responseEventName, room, map[string]interface{}{
						"initiator": clientID,
						"peerIds":   clientsToPeerIDs(clients),
						"nicknames": clients,
					}),
				)
				if len(clients) == 1 {
					message := map[string]interface{}{
						"room": room,
					}

					bytesRepresentation, err := json.Marshal(message)
					if err != nil {
						log.Printf("Error marshaling data message: %v", err)
					}

          http.DefaultTransport.(*http.Transport).TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
					resp, err := http.Post("http://localhost:8882/room", "application/json", bytes.NewBuffer(bytesRepresentation))
					if err != nil {
						log.Printf("Error sending request to kurento server: %v", err)
					}

					var result map[string]interface{}

					json.NewDecoder(resp.Body).Decode(&result)

					log.Printf("Result from kurento server: %v", result)
				}
			case "signal":
				payload, _ := msg.Payload.(map[string]interface{})
				signal, _ := payload["signal"]
				targetClientID, _ := payload["userId"].(string)

				responseEventName = "signal"
				log.Printf("Send signal from: %s to %s", clientID, targetClientID)
				err = adapter.Emit(targetClientID, NewMessage(responseEventName, room, map[string]interface{}{
					"userId": clientID,
					"signal": signal,
				}))
			case "ping":
				log.Printf("Send pong message to %s ", clientID)
				err = adapter.Emit(clientID, NewMessage(responseEventName, room, map[string]interface{}{
					"message": "pong",
				}))
			}

			if err != nil {
				log.Printf("Error sending event (event: %s, room: %s, source: %s)", responseEventName, room, clientID)
			}
		}
	}
	return http.HandlerFunc(fn)
}

func getReadyClients(adapter Adapter) (map[string]string, error) {
	filteredClients := map[string]string{}
	clients, err := adapter.Clients()
	if err != nil {
		return filteredClients, err
	}
	for clientID, nickname := range clients {
		// if nickame hasn't been set, the peer hasn't emitted ready yet so we
		// don't connect to that peer.
		if nickname != "" {
			filteredClients[clientID] = nickname
		}
	}
	return filteredClients, nil
}

func clientsToPeerIDs(clients map[string]string) (peers []string) {
	for clientID := range clients {
		peers = append(peers, clientID)
	}
	return
}
