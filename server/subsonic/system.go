package subsonic

import (
	"net/http"

	"github.com/Tian-MC/lyvune/model/request"
	"github.com/Tian-MC/lyvune/server/subsonic/responses"
)

func (api *Router) Ping(_ *http.Request) (*responses.Subsonic, error) {
	return newResponse(), nil
}

func (api *Router) GetLicense(_ *http.Request) (*responses.Subsonic, error) {
	response := newResponse()
	response.License = &responses.License{Valid: true}
	return response, nil
}

func (api *Router) TokenInfo(r *http.Request) (*responses.Subsonic, error) {
	user, _ := request.UserFrom(r.Context())
	response := newResponse()
	response.TokenInfo = &responses.TokenInfo{Username: user.UserName}
	return response, nil
}
