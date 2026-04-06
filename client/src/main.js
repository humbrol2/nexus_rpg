import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene.js';
import { HUDScene } from './scenes/HUDScene.js';
import {
  login, register, getToken, getUsername, isLoggedIn, isAdmin, logout,
  adminListUsers, adminPromote, adminDemote, adminBan, adminUnban, adminKick,
} from './auth.js';

function startGame() {
  document.getElementById('auth-screen').classList.add('hidden');

  // Show menu bar
  const menuBar = document.getElementById('menu-bar');
  menuBar.classList.add('visible');
  document.getElementById('menu-username').textContent = getUsername();

  // Show admin button if admin
  if (isAdmin()) {
    document.getElementById('btn-admin').style.display = 'flex';
  }

  // Menu button handlers — delegate to game scene via custom events
  const menuActions = {
    'btn-menu-inventory': 'toggleInventory',
    'btn-menu-crafting': 'toggleCrafting',
    'btn-menu-research': 'toggleResearch',
    'btn-menu-map': 'toggleWorldMap',
    'btn-menu-help': 'toggleHelp',
  };

  for (const [btnId, action] of Object.entries(menuActions)) {
    document.getElementById(btnId)?.addEventListener('click', () => {
      window._gameMenuAction = action;
    });
  }

  const config = {
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: '#111118',
    parent: document.body,
    pixelArt: true,
    scene: [GameScene],
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    fps: {
      target: 60,
      forceSetTimeOut: false,
    },
  };

  new Phaser.Game(config);
}

// ── Auth buttons ──

const errorEl = document.getElementById('auth-error');
const usernameEl = document.getElementById('auth-username');
const passwordEl = document.getElementById('auth-password');

document.getElementById('btn-login').addEventListener('click', async () => {
  errorEl.textContent = '';
  try {
    await login(usernameEl.value, passwordEl.value);
    startGame();
  } catch (e) {
    errorEl.textContent = e.message;
  }
});

document.getElementById('btn-register').addEventListener('click', async () => {
  errorEl.textContent = '';
  try {
    await register(usernameEl.value, passwordEl.value);
    startGame();
  } catch (e) {
    errorEl.textContent = e.message;
  }
});

passwordEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btn-login').click();
});
usernameEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') passwordEl.focus();
});

// ── Logout ──

document.getElementById('btn-logout').addEventListener('click', () => {
  logout();
});

// ── Admin panel ──

let adminPanelOpen = false;

document.getElementById('btn-admin').addEventListener('click', () => {
  adminPanelOpen = !adminPanelOpen;
  const panel = document.getElementById('admin-panel');
  if (adminPanelOpen) {
    panel.classList.add('visible');
    refreshAdminPanel();
  } else {
    panel.classList.remove('visible');
  }
});

async function refreshAdminPanel() {
  const list = document.getElementById('admin-users-list');
  list.innerHTML = 'Loading...';

  try {
    const users = await adminListUsers();
    list.innerHTML = '';

    for (const user of users) {
      const row = document.createElement('div');
      row.className = 'admin-user-row';

      let badges = '';
      if (user.is_admin) badges += '<span class="badge badge-admin">ADMIN</span>';
      if (user.is_banned) badges += '<span class="badge badge-banned">BANNED</span>';

      row.innerHTML = `
        <span class="name">#${user.id} ${user.username}</span>
        <span class="badges">${badges}</span>
        <span class="actions">
          ${!user.is_admin
            ? `<button data-action="promote" data-id="${user.id}">Promote</button>`
            : `<button data-action="demote" data-id="${user.id}">Demote</button>`
          }
          ${!user.is_banned
            ? `<button class="btn-danger" data-action="ban" data-id="${user.id}">Ban</button>`
            : `<button data-action="unban" data-id="${user.id}">Unban</button>`
          }
          <button data-action="kick" data-id="${user.id}">Kick</button>
        </span>
      `;
      list.appendChild(row);
    }

    // Wire up action buttons
    list.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        const id = parseInt(btn.dataset.id);
        try {
          if (action === 'promote') await adminPromote(id);
          else if (action === 'demote') await adminDemote(id);
          else if (action === 'ban') await adminBan(id);
          else if (action === 'unban') await adminUnban(id);
          else if (action === 'kick') await adminKick(id);
          refreshAdminPanel();
        } catch (e) {
          console.error('Admin action failed:', e);
        }
      });
    });
  } catch (e) {
    list.innerHTML = `<span style="color:#ff6b6b">${e.message}</span>`;
  }
}

// Auto-login if token exists — validate first
if (isLoggedIn()) {
  startGame();
}
// build: v2
