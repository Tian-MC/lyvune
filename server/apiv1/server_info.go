package apiv1

import (
	"context"
	"fmt"

	"github.com/Tian-MC/lyvune/api"
	"github.com/Tian-MC/lyvune/consts"
)

func (rt *Router) GetServerInfo(ctx context.Context, _ GetServerInfoRequestObject) (GetServerInfoResponseObject, error) {
	count, err := rt.ds.User().CountAll(ctx)
	if err != nil {
		return nil, fmt.Errorf("counting users: %w", err)
	}
	return GetServerInfo200JSONResponse{
		Name:          "Lyvune",
		ServerVersion: consts.Version,
		SpecVersion:   api.SpecVersion(),
		SetupRequired: count == 0,
		LoginMethods:  []ServerInfoLoginMethods{ServerInfoLoginMethodsPassword},
	}, nil
}
