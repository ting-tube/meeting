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

func (ja *JWTAuth) Encode(claims jwt.Claims) (t *jwt.Token, tokenString string, err error) {
	t = jwt.New(ja.signer)
	t.Claims = claims
	tokenString, err = t.SignedString(ja.signKey)
	t.Raw = tokenString
	return
}

func (ja *JWTAuth) Decode(tokenString string) (t *jwt.Token, err error) {
	t, err = ja.parser.Parse(tokenString, ja.keyFunc)
	if err != nil {
		return nil, err
	}
	return
}

func (ja *JWTAuth) keyFunc(t *jwt.Token) (interface{}, error) {
	if ja.verifyKey != nil {
		return ja.verifyKey, nil
	} else {
		return ja.signKey, nil
	}
}

func NewAuthContext(ctx context.Context, t *jwt.Token, err error) context.Context {
	ctx = context.WithValue(ctx, TokenCtxKey, t)
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

// TokenFromCookie tries to retreive the token string from a cookie named
// "jwt".
func TokenFromCookie(r *http.Request) string {
	fmt.Println(r.Cookies())
	cookie, err := r.Cookie("jwt")
	if err != nil {
		return ""
	}
	return cookie.Value
}

// JWTFromCookie tries to retreive the jwt.Token from a cookie named
// "jwt".
func JWTFromCookie(r *http.Request) (jwt.MapClaims, error) {
	tokenStr := TokenFromCookie(r)
	if tokenStr == "" {
		return nil, ErrNoTokenFound
	}
	token, err := tokenAuth.Decode(tokenStr)
	if err != nil {
		if verr, ok := err.(*jwt.ValidationError); ok {
			if verr.Errors&jwt.ValidationErrorExpired > 0 {
				return nil, ErrExpired
			} else if verr.Errors&jwt.ValidationErrorIssuedAt > 0 {
				return nil, ErrIATInvalid
			} else if verr.Errors&jwt.ValidationErrorNotValidYet > 0 {
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

// CreateTokenCookie create new token and saved in  cookie named
// "jwt".
func CreateTokenCookie(w http.ResponseWriter) string {
	userID := NewUUIDBase62()

	_, tokenString, err := tokenAuth.Encode(jwt.MapClaims{"user_id": userID})
	if err != nil {
		fmt.Println(err)
	}
	http.SetCookie(w, &http.Cookie{
		Name:    "jwt",
		Value:   tokenString,
		Path:    "/",
		Expires: time.Now().Add(time.Hour * 24 * 365),
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
