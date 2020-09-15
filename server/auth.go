package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/dgrijalva/jwt-go"
	"github.com/prometheus/common/log"
)

var (
	ErrUnauthorized = errors.New("jwtauth: token is unauthorized")
	ErrExpired      = errors.New("jwtauth: token is expired")
	ErrNBFInvalid   = errors.New("jwtauth: token nbf validation failed")
	ErrIATInvalid   = errors.New("jwtauth: token iat validation failed")
	ErrNoTokenFound = errors.New("jwtauth: no token found")
	ErrAlgoInvalid  = errors.New("jwtauth: algorithm mismatch")
)

type JWTAuth struct {
	signKey   interface{}
	verifyKey interface{}
	signer    jwt.SigningMethod
	parser    *jwt.Parser
}

var (
	TokenCtxKey = &contextKey{"Token"}
	ErrorCtxKey = &contextKey{"Error"}
)

var tokenAuth *JWTAuth

func InitAuth(secretKey []byte) {
	tokenAuth = &JWTAuth{
		signKey:   secretKey,
		verifyKey: nil,
		signer:    jwt.GetSigningMethod("HS256"),
		parser:    &jwt.Parser{},
	}
}

func (ja *JWTAuth) Encode(claims jwt.Claims) (token *jwt.Token, tokenString string, err error) {
	token = jwt.New(ja.signer)
	token.Claims = claims
	tokenString, err = token.SignedString(ja.signKey)
	token.Raw = tokenString
	return
}

func (ja *JWTAuth) Decode(tokenString string) (token *jwt.Token, err error) {
	token, err = ja.parser.Parse(tokenString, ja.keyFunc)
	if err != nil {
		return nil, err
	}
	return
}

func (ja *JWTAuth) keyFunc(token *jwt.Token) (interface{}, error) {
	if ja.verifyKey != nil {
		return ja.verifyKey, nil
	}
	return ja.signKey, nil
}

func NewAuthContext(ctx context.Context, token *jwt.Token, err error) context.Context {
	ctx = context.WithValue(ctx, TokenCtxKey, token)
	ctx = context.WithValue(ctx, ErrorCtxKey, err)
	return ctx
}

func FromAuthContext(ctx context.Context) (*jwt.Token, jwt.MapClaims, error) {
	token, _ := ctx.Value(TokenCtxKey).(*jwt.Token)

	var claims jwt.MapClaims
	if token != nil {
		if tokenClaims, ok := token.Claims.(jwt.MapClaims); ok {
			claims = tokenClaims
		} else {
			panic(fmt.Sprintf("jwtauth: unknown type of Claims: %T", token.Claims))
		}
	} else {
		claims = jwt.MapClaims{}
	}

	err, _ := ctx.Value(ErrorCtxKey).(error)

	return token, claims, err
}

// JWTTokenFromCookie tries to retrieve the jwt.MapClaims from a cookie named
// "jwt".
func JWTTokenFromCookie(r *http.Request) (jwt.MapClaims, error) {
	cookie, err := r.Cookie("jwt")
	if err != nil {
		return nil, ErrNoTokenFound
	}

	token, err := tokenAuth.Decode(cookie.Value)
	if err != nil {
		if validationErr, ok := err.(*jwt.ValidationError); ok {
			if validationErr.Errors&jwt.ValidationErrorExpired > 0 {
				return nil, ErrExpired
			} else if validationErr.Errors&jwt.ValidationErrorIssuedAt > 0 {
				return nil, ErrIATInvalid
			} else if validationErr.Errors&jwt.ValidationErrorNotValidYet > 0 {
				return nil, ErrNBFInvalid
			}
		}
		return nil, err
	}
	if token == nil || !token.Valid {
		err = ErrUnauthorized
		return nil, err
	}

	// Verify signing algorithm
	if token.Method != tokenAuth.signer {
		return nil, ErrAlgoInvalid
	}
	if tokenClaims, ok := token.Claims.(jwt.MapClaims); ok {
		return tokenClaims, nil
	}
	log.Error(fmt.Sprintf("jwtauth: unknown type of Claims: %T", token.Claims))
	return nil, ErrUnauthorized
}

// CreateTokenCookie create new jwt and saved in cookie named jwt
func CreateTokenCookie(w http.ResponseWriter) string {
	userID := NewUUIDBase62()

	_, tokenString, _ := tokenAuth.Encode(jwt.MapClaims{"user_id": userID})

	http.SetCookie(w, &http.Cookie{
		Name:    "jwt",
		Value:   tokenString,
		Path:    "/",
		Expires: time.Now().Add(time.Hour * 24 * 30),
	})
	return userID

}

// contextKey is a value for use with context.WithValue. It's used as
// a pointer so it fits in an interface{} without allocation. This technique
// for defining context keys was copied from Go 1.7's new use of context in net/http.
type contextKey struct {
	name string
}

func (k *contextKey) String() string {
	return "context value " + k.name
}
