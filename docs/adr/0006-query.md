# ADR-0006: Query facade

Status: accepted

`@kvt/query` is an optional OOP facade implemented with TanStack Query Core.
Applications consume KVT query definitions, QueryFlow and mutations; TanStack
client and observer types are not public API.

Query observers are owned by framework scopes and are destroyed with them.
React hooks are intentionally absent: repositories and ViewModels execute query
logic, and React observes their StateFlow projections.

