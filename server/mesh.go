package server

import (
	"net/http"
)

type ReadyMessage struct {
	UserID string `json:"userId"`
	Room   string `json:"room"`
}

func NewMeshHandler(loggerFactory LoggerFactory, wss *WSS, active_rooms map[string]ActiveRoom, recordServiceURL string) http.Handler {
	log := loggerFactory.GetLogger("mesh")
	fn := func(w http.ResponseWriter, r *http.Request) {
		sub, err := wss.Subscribe(w, r)
		token, err := JWTTokenFromCookie(r)
		if err != nil {
			w.WriteHeader(http.StatusForbidden)
			w.Write([]byte("Forbidden"))
			return
		}
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
						"recordStatus": getRoomRecordStatus(room, active_rooms),
						"recordUrl": recordServiceURL
					}),
				)
				if len(clients) == 0 {
					removeRoom(room, active_rooms)
				}
			case "signal":
				// todo check for auth
				payload, _ := msg.Payload.(map[string]interface{})
				signal, _ := payload["signal"]
				targetClientID, _ := payload["userId"].(string)

				responseEventName = "signal"
				log.Printf("Send signal from: %s to %s", clientID, targetClientID)
				err = adapter.Emit(targetClientID, NewMessage(responseEventName, room, map[string]interface{}{
					"userId": clientID,
					"signal": signal,
				}))

				/* 			case "ping":
				log.Printf("Send pong message to %s ", clientID)
				err = adapter.Emit(clientID, NewMessage(responseEventName, room, map[string]interface{}{
					"message": "pong",
				})) */
			case "create_room":
				payload, _ := msg.Payload.(map[string]interface{})
				roomReq, _ := payload["room"].(string)

				if roomExists(roomReq, active_rooms) {
					err = adapter.Emit(clientID, NewMessage("room_created", room, map[string]interface{}{ //TODO: room?
						"successful": "0",
						"creatorId":  getRoomCreator(roomReq, active_rooms),
					}))
				} else {
					createRoom(token["user_id"].(string), room, active_rooms)
					err = adapter.Emit(clientID, NewMessage("room_created", room, map[string]interface{}{ //TODO: room?
						"successful": "1",
						"creatorId":  token["user_id"].(string),
					}))
				}

			case "record":

				payload, _ := msg.Payload.(map[string]interface{})
				status, _ := payload["recordStatus"].(bool)

				if token["user_id"].(string) != getRoomCreator(room, active_rooms) {
					err = adapter.Broadcast(
						NewMessage("record_callback", room, map[string]interface{}{
							"successful": false,
						}),
					)
				} else {
					err = adapter.Broadcast(
						NewMessage("record_callback", room, map[string]interface{}{
							"successful":   true,
							"recordStatus": status,
							"url":          recordServiceURL,
						}),
					)
				}
			}

			if err != nil {
				log.Printf("Error sending event (event: %s, room: %s, source: %s)", responseEventName, room, clientID)
			}
		}
	}
	return http.HandlerFunc(fn)
}

func removeRoom(room string, active_rooms map[string]ActiveRoom) {
	delete(active_rooms, room)
}

func roomExists(room string, active_rooms map[string]ActiveRoom) bool {
	if _, ok := active_rooms[room]; ok {
		return true
	}
	return false
}

func getRoomCreator(room string, active_rooms map[string]ActiveRoom) string {
	return active_rooms[room].creatorId
}

func getRoomRecordStatus(room string, active_rooms map[string]ActiveRoom) bool {
	return active_rooms[room].recordStatus
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

func createRoom(roomCreatorID string, room string, active_rooms map[string]ActiveRoom) {
	active_rooms[room] = ActiveRoom{creatorId: roomCreatorID, recordStatus: false}
}
