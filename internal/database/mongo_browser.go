package database

import (
	"context"
	"strconv"

	"github.com/google/uuid"
)

// MongoListCollections returns the collection names in the database. The
// agent returns a JSON array in the result's RawText.
func (s *Service) MongoListCollections(ctx context.Context, userID, dbID uuid.UUID) (*QueryResult, error) {
	return s.ExecuteQuery(ctx, QueryRequest{
		DatabaseID: dbID,
		UserID:     userID,
		Operation:  "mongo_list_collections",
	})
}

// MongoFind runs a JSON filter against a collection with limit/skip. The
// agent returns the documents as an extended-JSON array in RawText.
func (s *Service) MongoFind(ctx context.Context, userID, dbID uuid.UUID, collection, filter string, limit, skip int) (*QueryResult, error) {
	if filter == "" {
		filter = "{}"
	}
	if limit <= 0 || limit > queryDefaultMaxRows {
		limit = 50
	}
	if skip < 0 {
		skip = 0
	}
	return s.ExecuteQuery(ctx, QueryRequest{
		DatabaseID: dbID,
		UserID:     userID,
		Operation:  "mongo_find",
		Params: map[string]string{
			"collection": collection,
			"filter":     filter,
			"limit":      strconv.Itoa(limit),
			"skip":       strconv.Itoa(skip),
		},
	})
}

// MongoGetDocument returns a single document by string id from a collection.
func (s *Service) MongoGetDocument(ctx context.Context, userID, dbID uuid.UUID, collection, id string) (*QueryResult, error) {
	return s.ExecuteQuery(ctx, QueryRequest{
		DatabaseID: dbID,
		UserID:     userID,
		Operation:  "mongo_get_doc",
		Params: map[string]string{
			"collection": collection,
			"id":         id,
		},
	})
}
