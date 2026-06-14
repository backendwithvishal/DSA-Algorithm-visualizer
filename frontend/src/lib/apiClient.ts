/**
 * Production-grade API client.
 *
 * Features:
 * - Base URL from environment variables
 * - Automatic Authorization header injection from in-memory token store
 * - Automatic access token refresh on 401 (via silent refresh endpoint)
 * - Structured error handling — always throws Error with a user-friendly message
 * - Correlation ID propagation
 * - No tokens stored in localStorage (security best practice)
 */

// In-memory token storage — never persisted to disk
let accessToken: string | null = null;
let isRefreshing = false;
let refreshQueue: Array<(token: string | null) => void> = [];

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:5000/api/v1';

// ── Token management ────────────────────────────────────────────────
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function clearAccessToken(): void {
  accessToken = null;
}

// ── Error class ─────────────────────────────────────────────────────
export class ApiError extends Error {
  public readonly status: number;
  public readonly errors?: Array<{ field: string; message: string }>;

  constructor(message: string, status: number, errors?: typeof ApiError.prototype.errors) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.errors = errors;
  }
}

// ── Core fetch wrapper ───────────────────────────────────────────────
async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  retry = true
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.headers as Record<string, string>)
  };

  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include' // Send httpOnly cookies (refresh token)
  });

  // Silent token refresh on 401
  if (response.status === 401 && retry && endpoint !== '/auth/refresh') {
    if (!isRefreshing) {
      isRefreshing = true;
      try {
        const refreshed = await refreshAccessToken();
        refreshQueue.forEach(cb => cb(refreshed));
        refreshQueue = [];
        // Retry the original request with the new token
        return request<T>(endpoint, options, false);
      } catch {
        refreshQueue.forEach(cb => cb(null));
        refreshQueue = [];
        clearAccessToken();
        // Dispatch logout event so auth store can react
        window.dispatchEvent(new CustomEvent('auth:logout'));
        throw new ApiError('Session expired. Please log in again.', 401);
      } finally {
        isRefreshing = false;
      }
    }

    // Queue subsequent requests until refresh is complete
    return new Promise((resolve, reject) => {
      refreshQueue.push((token) => {
        if (token) {
          resolve(request<T>(endpoint, options, false));
        } else {
          reject(new ApiError('Session expired. Please log in again.', 401));
        }
      });
    });
  }

  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`;
    let errors: ApiError['errors'];

    try {
      const body = await response.json();
      errorMessage = body.message || errorMessage;
      errors = body.errors;
    } catch {
      // Response body is not JSON
    }

    throw new ApiError(errorMessage, response.status, errors);
  }

  // Handle empty responses (e.g., 204 No Content)
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return null as unknown as T;
  }

  const body = await response.json();
  return body.data as T;
}

// ── Silent refresh helper ────────────────────────────────────────────
async function refreshAccessToken(): Promise<string> {
  const response = await fetch(`${BASE_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include' // Sends the httpOnly refresh token cookie
  });

  if (!response.ok) throw new Error('Refresh failed');

  const body = await response.json();
  const newToken = body.data?.accessToken;

  if (!newToken) throw new Error('No access token in refresh response');

  setAccessToken(newToken);
  return newToken;
}

// ── HTTP methods ─────────────────────────────────────────────────────
export const apiClient = {
  get: <T>(endpoint: string) =>
    request<T>(endpoint, { method: 'GET' }),

  post: <T>(endpoint: string, body?: unknown) =>
    request<T>(endpoint, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined
    }),

  put: <T>(endpoint: string, body?: unknown) =>
    request<T>(endpoint, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined
    }),

  patch: <T>(endpoint: string, body?: unknown) =>
    request<T>(endpoint, {
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined
    }),

  delete: <T>(endpoint: string) =>
    request<T>(endpoint, { method: 'DELETE' }),

  postForm: <T>(endpoint: string, formData: FormData) =>
    request<T>(endpoint, {
      method: 'POST',
      body: formData,
      headers: {} // Let browser set Content-Type with boundary for multipart
    })
};

export default apiClient;
