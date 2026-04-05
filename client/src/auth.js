/**
 * Auth module — handles login/register, stores JWT token.
 */

// Use relative URL in production, localhost in dev
const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:8000' : '';

export async function login(username, password) {
  const res = await fetch(`${API_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || 'Login failed');
  }
  const data = await res.json();
  localStorage.setItem('sc_token', data.token);
  localStorage.setItem('sc_username', data.username);
  localStorage.setItem('sc_is_admin', data.is_admin ? '1' : '0');
  return data;
}

export async function register(username, password) {
  const res = await fetch(`${API_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || 'Registration failed');
  }
  const data = await res.json();
  localStorage.setItem('sc_token', data.token);
  localStorage.setItem('sc_username', data.username);
  localStorage.setItem('sc_is_admin', data.is_admin ? '1' : '0');
  return data;
}

export function getToken() {
  return localStorage.getItem('sc_token');
}

export function getUsername() {
  return localStorage.getItem('sc_username');
}

export function isAdmin() {
  return localStorage.getItem('sc_is_admin') === '1';
}

export function logout() {
  localStorage.removeItem('sc_token');
  localStorage.removeItem('sc_username');
  localStorage.removeItem('sc_is_admin');
  window.location.reload();
}

export function isLoggedIn() {
  return !!getToken();
}

// ── Admin API ──

export async function adminListUsers() {
  const res = await fetch(`${API_URL}/admin/users?token=${getToken()}`);
  if (!res.ok) throw new Error('Failed to load users');
  return res.json();
}

export async function adminPromote(userId) {
  const res = await fetch(`${API_URL}/admin/promote/${userId}?token=${getToken()}`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed');
  return res.json();
}

export async function adminDemote(userId) {
  const res = await fetch(`${API_URL}/admin/demote/${userId}?token=${getToken()}`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed');
  return res.json();
}

export async function adminBan(userId) {
  const res = await fetch(`${API_URL}/admin/ban/${userId}?token=${getToken()}`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed');
  return res.json();
}

export async function adminUnban(userId) {
  const res = await fetch(`${API_URL}/admin/unban/${userId}?token=${getToken()}`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed');
  return res.json();
}

export async function adminKick(userId) {
  const res = await fetch(`${API_URL}/admin/kick/${userId}?token=${getToken()}`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed');
  return res.json();
}
