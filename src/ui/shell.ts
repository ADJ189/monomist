import type { Track } from '../core/types';
import type { PlayerEngine } from '../player/engine';
import type { MusicProvider } from '../music/provider';
import { ColorBridge } from '../visual/colorbridge';
import { CanvasVisualizer } from '../visual/canvas';
import { db, getRecentSearches, recordSearch } from '../storage/db';
import { getLikedTrackIds, isLiked, toggleLike } from '../library/likes';
import { addTrackToPlaylist, createPlaylist, deletePlaylist, getAllPlaylists, removeTrackFromPlaylist } from '../library/playlists';
import { getContinueListening, getRecentlyPlayed } from '../library/history';
import { getLyrics, saveLyrics } from '../lyrics/provider';
import { LyricsSync, type LyricsLine } from '../lyrics/sync';
import { bindKeyboardShortcuts } from './keyboard';
import { bindMediaSession } from '../player/media-session';
import { mountSettingsPanel } from './settings';
import { settingsStore } from '../storage/settings-store';
import type { Playlist } from '../core/types';

const fmt = (secs: number): string => {
  if (!Number.isFinite(secs) || secs < 0) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

type View = 'search' | 'library' | 'playlist';

export function mountShell(root: HTMLElement, engine: PlayerEngine, provider: MusicProvider): void {
  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="sidebar__brand">Session Clock · Music</div>
        <button class="nav-item active" data-nav="search"><span class="nav-item__icon" aria-hidden="true">🔍</span><span class="nav-item__label">Search</span></button>
        <button class="nav-item" data-nav="library"><span class="nav-item__icon" aria-hidden="true">📚</span><span class="nav-item__label">Library</span></button>
      </aside>

      <main class="main">
        <canvas class="ambient-canvas" id="ambient-canvas"></canvas>
        <div class="main__content" id="view-root"></div>
      </main>

      <div class="now-playing" id="now-playing">
        <div class="now-playing__track">
          <img class="now-playing__art" id="np-art" alt="" />
          <div class="now-playing__meta">
            <div class="marquee" id="np-title-wrap">
              <div class="marquee__inner now-playing__title" id="np-title">Nothing playing</div>
            </div>
            <div class="now-playing__artist" id="np-artist"></div>
          </div>
          <button class="expand-btn" id="btn-expand" title="Expand player" aria-label="Expand player">⌃</button>
          <button class="like-btn" id="btn-like" title="Like (L)">♡</button>
        </div>

        <div class="transport">
          <div class="transport__buttons">
            <button id="btn-shuffle" title="Shuffle (S)">⤨</button>
            <button id="btn-skip-back" title="-10s (←)">−10</button>
            <button id="btn-prev" title="Previous (P)">⏮</button>
            <button id="btn-play" class="primary" title="Play/Pause (Space)">▶</button>
            <button id="btn-next" title="Next (N)">⏭</button>
            <button id="btn-skip-fwd" title="+10s (→)">+10</button>
            <button id="btn-repeat" title="Repeat (R)">↻</button>
          </div>
          <div class="progress">
            <span id="np-current">0:00</span>
            <div class="progress__track" id="progress-track">
              <div class="progress__fill" id="progress-fill"></div>
            </div>
            <span id="np-duration">0:00</span>
          </div>
        </div>

        <div class="now-playing__right">
          <button class="speed-btn" id="btn-speed" title="Playback speed">1×</button>
          <button id="btn-mute" title="Mute (M)">🔊</button>
          <input type="range" id="vol" min="0" max="1" step="0.01" value="1" />
          <button id="btn-lyrics" title="Lyrics">Aa</button>
          <button id="btn-queue" title="Queue (Q)">☰</button>
          <button id="btn-mini" title="Mini player">▭</button>
          <button id="btn-settings" title="Settings (,)">⚙</button>
        </div>
      </div>

      <div class="side-drawer" id="side-drawer">
        <div class="side-drawer__tabs">
          <button class="side-drawer__tab active" data-tab="queue">Up next</button>
          <button class="side-drawer__tab" data-tab="lyrics">Lyrics</button>
        </div>
        <div class="side-drawer__panel" id="panel-queue">
          <div class="track-list" id="queue-list"></div>
        </div>
        <div class="side-drawer__panel" id="panel-lyrics" hidden>
          <div id="lyrics-body"></div>
        </div>
      </div>

      <div class="yt-surface" id="yt-surface"></div>
    </div>
  `;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const viewRoot = $<HTMLDivElement>('#view-root');

  const colorBridge = new ColorBridge();
  const canvas = new CanvasVisualizer(
    $<HTMLCanvasElement>('#ambient-canvas'),
    () => engine.analyser.read(),
    () => colorBridge.current
  );
  canvas.start();

  const settingsPanel = mountSettingsPanel(root, engine);
  $('#btn-settings').addEventListener('click', () => settingsPanel.open());
  settingsStore.subscribe((s) => {
    root.querySelector('.shell')!.classList.toggle('dense', s.compactDensity);
  });

  const lyricsSync = new LyricsSync();
  let speedIndex = SPEEDS.indexOf(1);
  let queueOpen = false;
  let activeTab: 'queue' | 'lyrics' = 'queue';

  // ---------------------------------------------------------------------
  // View routing
  // ---------------------------------------------------------------------
  let currentView: View = 'search';

  function setNav(view: View): void {
    root.querySelectorAll('.nav-item[data-nav]').forEach((el) => el.classList.remove('active'));
    if (view !== 'playlist') root.querySelector(`[data-nav="${view}"]`)?.classList.add('active');
  }

  async function showSearch(): Promise<void> {
    currentView = 'search';
    setNav('search');
    const recents = await getRecentSearches();
    viewRoot.innerHTML = `
      <div class="search-row">
        <input class="search-input" type="search" placeholder="Search — artists, tracks, albums (press /)" />
      </div>
      <div class="chip-row" id="recent-chips">
        ${recents.map((q) => `<button class="chip" data-query="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('')}
      </div>
      <div class="track-list" id="results"></div>
    `;
    wireSearch();
  }

  async function showLibrary(): Promise<void> {
    currentView = 'library';
    setNav('library');
    const [likedIds, playlists, continueIds, recent] = await Promise.all([
      getLikedTrackIds(),
      getAllPlaylists(),
      getContinueListening(10),
      getRecentlyPlayed(20)
    ]);

    viewRoot.innerHTML = `
      <section class="lib-section">
        <div class="lib-section__head">
          <h2>Playlists</h2>
          <button class="chip chip--accent" id="btn-new-playlist">+ New playlist</button>
        </div>
        <div class="playlist-grid" id="playlist-grid">
          ${
            playlists
              .map(
                (p) => `
            <button class="playlist-card" data-playlist="${p.id}">
              <div class="playlist-card__title">${escapeHtml(p.title)}</div>
              <div class="playlist-card__count">${p.trackIds.length} track${p.trackIds.length === 1 ? '' : 's'}</div>
            </button>`
              )
              .join('') || '<p class="empty">No playlists yet.</p>'
          }
        </div>
      </section>

      <section class="lib-section">
        <h2>Liked songs (${likedIds.length})</h2>
        <div class="track-list" id="liked-list"></div>
      </section>

      <section class="lib-section">
        <h2>Continue listening</h2>
        <div class="track-list" id="continue-list"></div>
      </section>

      <section class="lib-section">
        <h2>Recently played</h2>
        <div class="track-list" id="recent-list"></div>
      </section>
    `;

    await Promise.all([
      renderTracksById($('#liked-list'), likedIds),
      renderTracksById($('#continue-list'), continueIds),
      renderTracksById($('#recent-list'), dedupePreserveOrder(recent.map((r) => r.trackId)))
    ]);

    $('#btn-new-playlist').addEventListener('click', async () => {
      const title = window.prompt('Playlist name');
      if (title === null) return;
      await createPlaylist(title);
      void showLibrary();
    });

    root.querySelectorAll<HTMLButtonElement>('[data-playlist]').forEach((btn) => {
      btn.addEventListener('click', () => void showPlaylist(btn.dataset.playlist!));
    });
  }

  async function showPlaylist(playlistId: string): Promise<void> {
    currentView = 'playlist';
    setNav('library');
    const playlist = await db.playlists.get(playlistId);
    if (!playlist) return void showLibrary();

    viewRoot.innerHTML = `
      <div class="playlist-header">
        <button class="chip" id="btn-back-library">← Library</button>
        <h1>${escapeHtml(playlist.title)}</h1>
        <button class="chip chip--danger" id="btn-delete-playlist">Delete</button>
      </div>
      <div class="track-list" id="playlist-track-list"></div>
    `;
    await renderTracksById($('#playlist-track-list'), playlist.trackIds, {
      onRemove: async (trackId) => {
        await removeTrackFromPlaylist(playlistId, trackId);
        void showPlaylist(playlistId);
      }
    });
    $('#btn-back-library').addEventListener('click', () => void showLibrary());
    $('#btn-delete-playlist').addEventListener('click', async () => {
      if (!window.confirm(`Delete "${playlist.title}"?`)) return;
      await deletePlaylist(playlistId);
      void showLibrary();
    });
  }

  root.querySelector('[data-nav="search"]')!.addEventListener('click', () => void showSearch());
  root.querySelector('[data-nav="library"]')!.addEventListener('click', () => void showLibrary());

  // ---------------------------------------------------------------------
  // Search: debounced, cancels in-flight requests, records recent searches
  // ---------------------------------------------------------------------
  let searchController: AbortController | null = null;
  let debounceHandle: number | null = null;

  function wireSearch(): void {
    const input = $<HTMLInputElement>('.search-input');
    input.addEventListener('input', () => {
      if (debounceHandle) window.clearTimeout(debounceHandle);
      debounceHandle = window.setTimeout(() => void runSearch(input.value.trim()), 300);
    });
    root.querySelectorAll<HTMLButtonElement>('#recent-chips [data-query]').forEach((chip) => {
      chip.addEventListener('click', () => {
        input.value = chip.dataset.query ?? '';
        void runSearch(input.value);
      });
    });
  }

  async function runSearch(query: string): Promise<void> {
    searchController?.abort();
    const resultsEl = $('#results');
    if (!query) {
      resultsEl.innerHTML = '';
      return;
    }
    searchController = new AbortController();
    try {
      const results = await provider.search(query, searchController.signal);
      await renderTrackList(resultsEl, results.tracks, results.tracks);
      void recordSearch(query);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') console.error('Search failed', err);
    }
  }

  // ---------------------------------------------------------------------
  // Track list rendering (shared by every view)
  // ---------------------------------------------------------------------
  interface RenderOpts {
    onRemove?: (trackId: string) => void;
  }

  async function renderTracksById(container: HTMLElement, trackIds: string[], opts?: RenderOpts): Promise<void> {
    if (trackIds.length === 0) {
      container.innerHTML = '<p class="empty">Nothing here yet.</p>';
      return;
    }
    const tracks = (await db.tracks.bulkGet(trackIds)).filter((t): t is Track => Boolean(t));
    await renderTrackList(container, tracks, tracks, opts);
  }

  async function renderTrackList(
    container: HTMLElement,
    tracks: Track[],
    playContext: Track[],
    opts?: RenderOpts
  ): Promise<void> {
    container.innerHTML = '';
    if (tracks.length === 0) {
      container.innerHTML = '<p class="empty">Nothing here yet.</p>';
      return;
    }
    const likedFlags = await Promise.all(tracks.map((t) => isLiked(t.id)));
    const frag = document.createDocumentFragment();
    tracks.forEach((track, i) => {
      const row = document.createElement('div');
      row.className = 'track-row';
      row.innerHTML = `
        <img src="${track.artwork?.url ?? ''}" alt="" loading="lazy" />
        <button class="track-row__main">
          <div class="track-row__title">${escapeHtml(track.title)}</div>
          <div class="track-row__artist">${escapeHtml(track.artist)}</div>
        </button>
        <div class="track-row__duration">${track.durationSec ? fmt(track.durationSec) : ''}</div>
        <button class="track-row__like ${likedFlags[i] ? 'liked' : ''}" data-like title="Like">${likedFlags[i] ? '♥' : '♡'}</button>
        <button class="track-row__menu" data-menu title="Add to playlist">⋯</button>
        ${opts?.onRemove ? '<button class="track-row__remove" data-remove title="Remove">✕</button>' : ''}
      `;
      row.querySelector('.track-row__main')!.addEventListener('click', () => void engine.playTracks(playContext, i));
      row.querySelector('[data-like]')!.addEventListener('click', async (e) => {
        e.stopPropagation();
        const liked = await toggleLike(track.id);
        void db.tracks.put(track);
        (e.currentTarget as HTMLButtonElement).textContent = liked ? '♥' : '♡';
        (e.currentTarget as HTMLButtonElement).classList.toggle('liked', liked);
      });
      row.querySelector('[data-menu]')!.addEventListener('click', async (e) => {
        e.stopPropagation();
        await showAddToPlaylistMenu(track);
      });
      if (opts?.onRemove) {
        row.querySelector('[data-remove]')!.addEventListener('click', (e) => {
          e.stopPropagation();
          opts.onRemove!(track.id);
        });
      }
      frag.appendChild(row);
    });
    container.appendChild(frag);
  }

  async function showAddToPlaylistMenu(track: Track): Promise<void> {
    const playlists = await getAllPlaylists();
    if (playlists.length === 0) {
      const title = window.prompt('No playlists yet — name a new one to add this track:');
      if (!title) return;
      const pl = await createPlaylist(title);
      await addTrackToPlaylist(pl.id, track.id);
      void db.tracks.put(track);
      return;
    }
    const options = playlists.map((p, i) => `${i + 1}. ${p.title}`).join('\n');
    const pick = window.prompt(`Add "${track.title}" to which playlist?\n${options}\n\nEnter a number:`);
    const idx = pick ? Number(pick) - 1 : -1;
    const target: Playlist | undefined = playlists[idx];
    if (!target) return;
    await addTrackToPlaylist(target.id, track.id);
    void db.tracks.put(track);
  }

  function dedupePreserveOrder(ids: string[]): string[] {
    const seen = new Set<string>();
    return ids.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
  }

  // ---------------------------------------------------------------------
  // Transport controls
  // ---------------------------------------------------------------------
  // Cache these once instead of re-querying the DOM on every click and on
  // every engine event (play/mute/speed/shuffle/repeat all toggle several
  // times a session, and none of these nodes are ever replaced).
  const btnPlay = $<HTMLButtonElement>('#btn-play');
  const btnMute = $<HTMLButtonElement>('#btn-mute');
  const btnSpeed = $<HTMLButtonElement>('#btn-speed');
  const btnShuffle = $<HTMLButtonElement>('#btn-shuffle');
  const btnRepeat = $<HTMLButtonElement>('#btn-repeat');
  const btnLike = $<HTMLButtonElement>('#btn-like');

  btnPlay.addEventListener('click', () => engine.togglePlayPause());
  $('#btn-next').addEventListener('click', () => void engine.next());
  $('#btn-prev').addEventListener('click', () => void engine.previous());
  $('#btn-skip-fwd').addEventListener('click', () => engine.skip(10));
  $('#btn-skip-back').addEventListener('click', () => engine.skip(-10));
  btnMute.addEventListener('click', () => {
    engine.toggleMute();
    btnMute.textContent = engine.isMuted ? '🔇' : '🔊';
  });
  btnSpeed.addEventListener('click', () => {
    speedIndex = (speedIndex + 1) % SPEEDS.length;
    const rate = SPEEDS[speedIndex];
    engine.setPlaybackRate(rate);
    btnSpeed.textContent = `${rate}×`;
    if (settingsStore.get().rememberSpeed) settingsStore.update({ lastSpeed: rate });
  });
  // Restore a remembered speed once the persisted settings (if any) have loaded --
  // this only ever fires once, and does nothing when "remember speed" is off.
  void settingsStore.whenReady().then(() => {
    const s = settingsStore.get();
    if (!s.rememberSpeed) return;
    const idx = SPEEDS.indexOf(s.lastSpeed);
    if (idx === -1) return;
    speedIndex = idx;
    engine.setPlaybackRate(SPEEDS[idx]);
    btnSpeed.textContent = `${SPEEDS[idx]}×`;
  });
  btnShuffle.addEventListener('click', () => {
    engine.toggleShuffle();
    btnShuffle.classList.toggle('active', engine.shuffle);
  });
  btnRepeat.addEventListener('click', () => {
    engine.cycleRepeat();
    btnRepeat.classList.toggle('active', engine.repeat !== 'off');
  });

  const volInput = $<HTMLInputElement>('#vol');
  volInput.addEventListener('input', () => engine.setVolume(Number(volInput.value)));

  const progressTrack = $('#progress-track');
  let seekDurationSec = 0;
  progressTrack.addEventListener('click', (e) => {
    const rect = progressTrack.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    engine.seek(ratio * seekDurationSec);
  });

  btnLike.addEventListener('click', () => void toggleLikeCurrent());
  async function toggleLikeCurrent(): Promise<void> {
    const track = engine.currentTrack;
    if (!track) return;
    const liked = await toggleLike(track.id);
    void db.tracks.put(track);
    btnLike.textContent = liked ? '♥' : '♡';
    btnLike.classList.toggle('liked', liked);
  }

  // ---------------------------------------------------------------------
  // Side drawer: queue + lyrics, tabbed
  // ---------------------------------------------------------------------
  const drawer = $('#side-drawer');
  function setDrawer(open: boolean): void {
    queueOpen = open;
    drawer.classList.toggle('open', open);
  }
  $('#btn-queue').addEventListener('click', () => {
    if (queueOpen && activeTab === 'queue') return setDrawer(false);
    setTab('queue');
    setDrawer(true);
  });
  $('#btn-lyrics').addEventListener('click', () => {
    if (queueOpen && activeTab === 'lyrics') return setDrawer(false);
    setTab('lyrics');
    setDrawer(true);
  });

  function setTab(tab: 'queue' | 'lyrics'): void {
    activeTab = tab;
    root.querySelectorAll('.side-drawer__tab').forEach((el) => el.classList.toggle('active', (el as HTMLElement).dataset.tab === tab));
    $('#panel-queue').hidden = tab !== 'queue';
    $('#panel-lyrics').hidden = tab !== 'lyrics';
    if (tab === 'lyrics') void renderLyricsPanel();
  }
  root.querySelectorAll<HTMLButtonElement>('.side-drawer__tab').forEach((btn) => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab as 'queue' | 'lyrics'));
  });

  async function renderQueueDrawer(): Promise<void> {
    const ids = [...engine.activeQueueIds];
    const container = $('#queue-list');
    if (ids.length === 0) {
      container.innerHTML = '<p class="empty">Queue is empty.</p>';
      return;
    }
    const tracks = ids.map((id) => engine.getTrack(id)).filter((t): t is Track => Boolean(t));
    await renderTrackList(container, tracks, tracks, {
      onRemove: (id) => {
        engine.removeFromQueue(id);
        void renderQueueDrawer();
      }
    });
  }

  // ---------------------------------------------------------------------
  // Lyrics panel
  // ---------------------------------------------------------------------
  const lyricsBody = $('#lyrics-body');

  async function renderLyricsPanel(): Promise<void> {
    const track = engine.currentTrack;
    if (!track) {
      lyricsBody.innerHTML = '<p class="empty">Nothing playing.</p>';
      return;
    }
    const saved = await getLyrics(track.id);
    if (saved && lyricsSync.load(saved)) {
      renderLyricsLines(lyricsSync.lines);
      return;
    }
    lyricsBody.innerHTML = `
      <p class="empty">No lyrics saved for this track yet.</p>
      <textarea id="lrc-input" placeholder="Paste LRC-format lyrics here..." rows="8"></textarea>
      <button class="chip chip--accent" id="btn-save-lyrics">Save lyrics</button>
    `;
    $('#btn-save-lyrics').addEventListener('click', async () => {
      const text = $<HTMLTextAreaElement>('#lrc-input').value;
      if (!text.trim()) return;
      await saveLyrics(track.id, text);
      void renderLyricsPanel();
    });
  }

  function renderLyricsLines(lines: LyricsLine[]): void {
    lyricsBody.innerHTML = `<div class="lyrics-lines">${lines
      .map((l, i) => `<p class="lyrics-line" data-index="${i}" data-time="${l.time}">${escapeHtml(l.text || '\u00A0')}</p>`)
      .join('')}</div>`;
    lyricsBody.querySelectorAll<HTMLElement>('.lyrics-line').forEach((el) => {
      el.addEventListener('click', () => engine.seek(Number(el.dataset.time)));
    });
  }

  lyricsSync.onLineChange((line) => {
    lyricsBody.querySelectorAll('.lyrics-line').forEach((el) => el.classList.remove('active'));
    if (line?.index === undefined) return;
    const el = lyricsBody.querySelector(`.lyrics-line[data-index="${line.index}"]`);
    el?.classList.add('active');
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  // ---------------------------------------------------------------------
  // Mini player mode
  // ---------------------------------------------------------------------
  $('#btn-mini').addEventListener('click', () => {
    root.querySelector('.shell')!.classList.toggle('mini');
  });

  // ---------------------------------------------------------------------
  // Mobile full-player expand (see style.css's max-width: 880px block --
  // this button only renders there; on desktop everything is visible already).
  // ---------------------------------------------------------------------
  const nowPlayingEl = $('#now-playing');
  const btnExpand = $<HTMLButtonElement>('#btn-expand');
  btnExpand.addEventListener('click', () => {
    const expanded = nowPlayingEl.classList.toggle('expanded');
    btnExpand.textContent = expanded ? '⌄' : '⌃';
    btnExpand.title = expanded ? 'Collapse player' : 'Expand player';
  });

  // ---------------------------------------------------------------------
  // Engine -> UI
  // ---------------------------------------------------------------------
  const titleWrap = $('#np-title-wrap');
  const titleEl = $('#np-title');

  engine.on((event) => {
    switch (event.type) {
      case 'trackchange': {
        const t = event.track;
        $<HTMLImageElement>('#np-art').src = t?.artwork?.url ?? '';
        titleEl.textContent = t?.title ?? 'Nothing playing';
        $('#np-artist').textContent = t?.artist ?? '';
        colorBridge.setArtwork(t?.artwork?.url);
        requestAnimationFrame(() => {
          titleWrap.classList.toggle('overflowing', titleEl.scrollWidth > titleWrap.clientWidth);
        });
        if (t) {
          void isLiked(t.id).then((liked) => {
            btnLike.textContent = liked ? '♥' : '♡';
            btnLike.classList.toggle('liked', liked);
          });
        }
        void renderQueueDrawer();
        lyricsSync.clear();
        if (activeTab === 'lyrics' && queueOpen) void renderLyricsPanel();
        break;
      }
      case 'playstate':
        btnPlay.textContent = event.playing ? '⏸' : '▶';
        break;
      case 'timeupdate': {
        seekDurationSec = event.durationSec;
        $('#np-current').textContent = fmt(event.currentSec);
        $('#np-duration').textContent = fmt(event.durationSec);
        const pct = event.durationSec > 0 ? (event.currentSec / event.durationSec) * 100 : 0;
        $<HTMLDivElement>('#progress-fill').style.width = `${pct}%`;
        lyricsSync.feed(event.currentSec);
        break;
      }
      case 'error':
        console.error('Playback error', event.error);
        break;
    }
  });

  bindKeyboardShortcuts(engine, {
    focusSearch: () => {
      if (currentView !== 'search') void showSearch();
      requestAnimationFrame(() => root.querySelector<HTMLInputElement>('.search-input')?.focus());
    },
    toggleQueue: () => setDrawer(!queueOpen),
    toggleLikeCurrent: () => void toggleLikeCurrent(),
    openSettings: () => settingsPanel.open()
  });

  bindMediaSession(engine);

  void showSearch();
  void renderQueueDrawer();
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
