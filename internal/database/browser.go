package database

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"
)

// SchemaList is the response shape for ListSchemas.
type SchemaList struct {
	Schemas []string `json:"schemas"`
}

// TableInfo describes a single table for the browser. RowCount is filled in
// best-effort via a follow-up COUNT(*) query and may be -1 when unknown.
type TableInfo struct {
	Name     string `json:"name"`
	RowCount int64  `json:"row_count"`
}

// TableList is the response shape for ListTables.
type TableList struct {
	Tables []TableInfo `json:"tables"`
}

// RowPage is a paginated slice of rows for the browser. Total is best-effort
// and may be 0 when COUNT(*) was skipped (very large tables).
type RowPage struct {
	Columns []QueryColumn `json:"columns"`
	Rows    []QueryRow    `json:"rows"`
	Page    int           `json:"page"`
	Limit   int           `json:"limit"`
	Total   int64         `json:"total"`
}

// safeIdent allows simple identifier characters only. Used to gate
// dynamically-built schema/table/column names — never user data.
func safeIdent(s string) bool {
	if s == "" || len(s) > 63 {
		return false
	}
	for i, r := range s {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r == '_':
		case i > 0 && (r >= '0' && r <= '9'):
		default:
			return false
		}
	}
	return true
}

// ListSchemas returns the schemas (PG) or databases (MySQL) for a managed
// database. Mongo and Redis return an empty list — they don't have schemas
// in this sense.
func (s *Service) ListSchemas(ctx context.Context, userID, dbID uuid.UUID) (*SchemaList, error) {
	res, err := s.ExecuteQuery(ctx, QueryRequest{
		DatabaseID: dbID,
		UserID:     userID,
		Operation:  "list_schemas",
	})
	if err != nil {
		return nil, err
	}
	if !res.Success {
		return nil, errors.New(res.Error)
	}
	out := &SchemaList{Schemas: make([]string, 0, len(res.Rows))}
	for _, r := range res.Rows {
		if len(r.Values) > 0 {
			out.Schemas = append(out.Schemas, r.Values[0])
		}
	}
	return out, nil
}

// ListTables returns the tables in a schema. RowCount is filled per table
// best-effort; on failure it stays at -1.
func (s *Service) ListTables(ctx context.Context, userID, dbID uuid.UUID, schema string) (*TableList, error) {
	if !safeIdent(schema) {
		return nil, fmt.Errorf("invalid schema name: %q", schema)
	}
	res, err := s.ExecuteQuery(ctx, QueryRequest{
		DatabaseID: dbID,
		UserID:     userID,
		Operation:  "list_tables",
		Params:     map[string]string{"schema": schema},
	})
	if err != nil {
		return nil, err
	}
	if !res.Success {
		return nil, errors.New(res.Error)
	}
	tables := make([]TableInfo, 0, len(res.Rows))
	for _, r := range res.Rows {
		if len(r.Values) == 0 {
			continue
		}
		tables = append(tables, TableInfo{Name: r.Values[0], RowCount: -1})
	}
	return &TableList{Tables: tables}, nil
}

// GetTableRows returns a page of rows from a table with optional ORDER BY.
// page is zero-indexed; limit is capped at 1000. sortColumn must match
// safeIdent or sorting is dropped silently. sortOrder is ASC or DESC.
func (s *Service) GetTableRows(
	ctx context.Context,
	userID, dbID uuid.UUID,
	schema, table string,
	page, limit int,
	sortColumn, sortOrder string,
) (*RowPage, error) {
	if !safeIdent(schema) || !safeIdent(table) {
		return nil, fmt.Errorf("invalid schema or table name")
	}
	if page < 0 {
		page = 0
	}
	if limit <= 0 || limit > queryDefaultMaxRows {
		limit = 100
	}
	order := strings.ToUpper(strings.TrimSpace(sortOrder))
	if order != "ASC" && order != "DESC" {
		order = "ASC"
	}
	params := map[string]string{
		"schema": schema,
		"table":  table,
		"page":   strconv.Itoa(page),
		"limit":  strconv.Itoa(limit),
		"order":  order,
	}
	if sortColumn != "" && safeIdent(sortColumn) {
		params["sort"] = sortColumn
	}
	res, err := s.ExecuteQuery(ctx, QueryRequest{
		DatabaseID: dbID,
		UserID:     userID,
		Operation:  "get_rows",
		Params:     params,
	})
	if err != nil {
		return nil, err
	}
	if !res.Success {
		return nil, errors.New(res.Error)
	}

	out := &RowPage{
		Columns: res.Columns,
		Rows:    res.Rows,
		Page:    page,
		Limit:   limit,
		Total:   -1,
	}

	// Best-effort COUNT(*) — failure leaves Total at -1.
	countRes, cerr := s.ExecuteQuery(ctx, QueryRequest{
		DatabaseID: dbID,
		UserID:     userID,
		Operation:  "count_rows",
		Params:     map[string]string{"schema": schema, "table": table},
	})
	if cerr == nil && countRes.Success && len(countRes.Rows) > 0 && len(countRes.Rows[0].Values) > 0 {
		if n, perr := strconv.ParseInt(countRes.Rows[0].Values[0], 10, 64); perr == nil {
			out.Total = n
		}
	}
	return out, nil
}
