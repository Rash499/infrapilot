# Three-tier architecture

```text
Browser -> Next.js frontend -> Express backend -> MongoDB
                                  ^
                                  |
                         Monitoring worker
```

The frontend renders UI and communicates through the centralized Axios client. It does not contain MongoDB credentials or database queries.

The Express backend owns authentication, authorization, validation, business services, repositories, and HTTP error handling. API routes are versioned under `/api/v1`.

The monitoring worker is a separate process and owns scheduled probes and monitoring state updates.
