import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const CONFIG = window.TRPG_ARCHIVE_CONFIG || {};
const TABLE = 'scenarios';
const BUCKET = 'scenario-thumbnails';
const CATEGORY_DEFS = [
  { code: '00', name: '公式シナリオ' },
  { code: '01', name: 'キャンペーン' },
  { code: '02', name: 'シナリオ集' },
  { code: '03', name: '単品シナリオ' },
  { code: '04', name: '個人頒布' },
  { code: '05', name: '企画' },
  { code: '99', name: '未分類（CSV取込）' }
];
const PLAYER_OPTIONS = ['ソロ', 'タイマン', '2PL', '3PL', '4PL', '5PL', '6PL', '人数融通有'];
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'];
const MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024;

const $ = (id) => document.getElementById(id);
let supabase;
let currentUser = null;
let scenarios = [];
let currentFilter = 'all';
let currentCategory = 'all';
let currentEditingId = null;
let rootHandle = null;
let toastTimer = null;

const authScreen = $('auth-screen');
const appScreen = $('app');
const detailDialog = $('detail-dialog');

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

function setNotice(message, type = 'info') {
  const notice = $('notice');
  if (!message) {
    notice.classList.add('hidden');
    notice.textContent = '';
    notice.classList.remove('warn');
    return;
  }
  notice.textContent = message;
  notice.classList.remove('hidden');
  notice.classList.toggle('warn', type === 'warn');
}

function setProgress(percent, show = true) {
  $('progress-wrap').classList.toggle('hidden', !show);
  $('progress-bar').style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function configIsReady() {
  return CONFIG.supabaseUrl && CONFIG.supabaseAnonKey &&
    !CONFIG.supabaseUrl.includes('YOUR-PROJECT') &&
    !CONFIG.supabaseAnonKey.includes('YOUR_SUPABASE');
}

function showAuthMessage(message, isError = false) {
  const el = $('auth-message');
  el.textContent = message;
  el.style.color = isError ? '#e5a5a5' : '#b8d2c0';
}

async function signIn() {
  const email = $('auth-email').value.trim();
  const password = $('auth-password').value;
  if (!email || !password) return showAuthMessage('メールアドレスとパスワードを入力してください。', true);
  $('login-btn').disabled = true;
  showAuthMessage('ログインしています…');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  $('login-btn').disabled = false;
  if (error) showAuthMessage(error.message, true);
}

async function signUp() {
  const email = $('auth-email').value.trim();
  const password = $('auth-password').value;
  if (!email || !password) return showAuthMessage('メールアドレスとパスワードを入力してください。', true);
  if (password.length < 8) return showAuthMessage('パスワードは8文字以上にしてください。', true);
  $('signup-btn').disabled = true;
  showAuthMessage('アカウントを作成しています…');
  const { data, error } = await supabase.auth.signUp({ email, password });
  $('signup-btn').disabled = false;
  if (error) return showAuthMessage(error.message, true);
  if (!data.session) showAuthMessage('確認メールを送信しました。メール内のリンクから登録を完了してください。');
  else showAuthMessage('アカウントを作成しました。');
}

async function signOut() {
  await supabase.auth.signOut();
  currentUser = null;
  scenarios = [];
  authScreen.classList.remove('hidden');
  appScreen.classList.add('hidden');
}

function showApp(user) {
  currentUser = user;
  authScreen.classList.add('hidden');
  appScreen.classList.remove('hidden');
  $('folder-state').textContent = rootHandle ? `監視フォルダ：${rootHandle.name}` : '監視フォルダ：未設定';
  $('scan-btn').disabled = !rootHandle;
  $('mobile-scan-btn').disabled = !rootHandle;
  loadScenarios();
}

async function loadScenarios() {
  if (!currentUser) return;
  const { data, error } = await supabase.from(TABLE).select('*').eq('user_id', currentUser.id).order('title').range(0, 4999);
  if (error) {
    setNotice(`データを読み込めませんでした：${error.message}`, 'warn');
    return;
  }
  const rows = data || [];
  const signed = await Promise.all(rows.map(async (row) => {
    if (!row.thumbnail_object_path) return { ...row, thumbnail_url: null };
    const { data: signedData } = await supabase.storage.from(BUCKET).createSignedUrl(row.thumbnail_object_path, 3600);
    return { ...row, thumbnail_url: signedData?.signedUrl || null };
  }));
  scenarios = signed;
  render();
}

function categoryLabel(code) {
  const item = CATEGORY_DEFS.find((category) => category.code === code);
  return item ? item.name : code || '未分類';
}

function selectedPlayerFilters() {
  return [...document.querySelectorAll('input[name="players"]:checked')].map((el) => el.value);
}

function filterRows() {
  const query = $('search').value.trim().toLocaleLowerCase();
  const playerFilters = selectedPlayerFilters();
  const r18Only = $('filter-r18').checked;
  const paidOnly = $('filter-paid').checked;
  const unknownOnly = $('filter-unread').checked;
  let rows = scenarios.filter((row) => {
    if (query && !`${row.title || ''} ${row.author_name || ''} ${row.category_name || ''}`.toLocaleLowerCase().includes(query)) return false;
    if (currentCategory !== 'all' && row.category_code !== currentCategory) return false;
    if (currentFilter === 'favorite' && !row.is_favorite) return false;
    if (currentFilter === 'kp' && !row.kp_done) return false;
    if (currentFilter === 'pl' && !row.pl_done) return false;
    if (currentFilter === 'unread' && row.read_status !== '未読') return false;
    if (currentFilter === 'missing' && row.folder_exists !== false) return false;
    if (playerFilters.length && !playerFilters.some((value) => getPlayerTypes(row.player_count).includes(value))) return false;
    if (r18Only && row.r_rating !== 'あり') return false;
    if (paidOnly && row.paid_status !== '有償') return false;
    if (unknownOnly && !(row.r_rating === '未確認' || row.paid_status === '未確認' || !row.player_count)) return false;
    return true;
  });
  const sort = $('sort-select').value;
  rows.sort((a, b) => {
    if (sort === 'category') return (a.category_code || '').localeCompare(b.category_code || '') || (a.title || '').localeCompare(b.title || '', 'ja');
    if (sort === 'newest') return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
    if (sort === 'players') return playerNumber(a.player_count) - playerNumber(b.player_count) || (a.title || '').localeCompare(b.title || '', 'ja');
    return (a.title || '').localeCompare(b.title || '', 'ja');
  });
  return rows;
}

function getPlayerTypes(value) {
  if (Array.isArray(value)) return value.filter((item) => PLAYER_OPTIONS.includes(item));
  const raw = String(value || '').trim();
  if (!raw) return [];
  const normalized = raw.normalize('NFKC').replace(/[、，,;；|／/・\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  const found = [];
  for (const option of PLAYER_OPTIONS) {
    const pattern = option === '人数融通有'
      ? /人数\s*融通\s*(有|あり|可)/i
      : new RegExp(option.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (pattern.test(normalized) || (option === '人数融通有' && /人数融通/.test(normalized))) found.push(option);
  }
  return found;
}

function playerNumber(value) {
  const types = getPlayerTypes(value);
  if (!types.length) return 999;
  const order = ['ソロ', 'タイマン', '2PL', '3PL', '4PL', '5PL', '6PL', '人数融通有'];
  return Math.min(...types.map((item) => order.indexOf(item)).filter((n) => n >= 0));
}

function renderSidebarCounts() {
  const count = (fn) => scenarios.filter(fn).length;
  $('count-all').textContent = scenarios.length;
  $('count-favorite').textContent = count((x) => x.is_favorite);
  $('count-kp').textContent = count((x) => x.kp_done);
  $('count-pl').textContent = count((x) => x.pl_done);
  $('count-unread').textContent = count((x) => x.read_status === '未読');
  $('count-missing').textContent = count((x) => x.folder_exists === false);
  $('category-filters').innerHTML = CATEGORY_DEFS.map((category) => {
    const total = count((x) => x.category_code === category.code);
    return `<button class="category-filter ${currentCategory === category.code ? 'active' : ''}" data-category="${category.code}"><i class="category-dot"></i>${escapeHtml(category.name)}<b>${total}</b></button>`;
  }).join('');
  document.querySelectorAll('.filter-link').forEach((button) => button.classList.toggle('active', button.dataset.filter === currentFilter));
}

function renderCards(rows) {
  const grid = $('scenario-grid');
  grid.innerHTML = rows.map((row) => {
    const chips = [];
    if (row.kp_done) chips.push('<span class="chip">KP済</span>');
    if (row.pl_done) chips.push('<span class="chip">PL済</span>');
    if (row.read_status === '既読') chips.push('<span class="chip neutral">既読</span>');
    else chips.push('<span class="chip neutral">未読</span>');
    if (row.r_rating === 'あり') chips.push('<span class="chip warn">R指定</span>');
    if (row.paid_status === '有償') chips.push('<span class="chip warn">有償</span>');
    if (row.folder_exists === false) chips.push('<span class="chip missing">フォルダ未検出</span>');
    const cover = row.thumbnail_url
      ? `<img src="${escapeHtml(row.thumbnail_url)}" alt="${escapeHtml(row.title)}のサムネイル" loading="lazy">`
      : '<span class="cover-placeholder">▧</span>';
    return `<article class="scenario-card" data-id="${row.id}" tabindex="0" role="button" aria-label="${escapeHtml(row.title)}の詳細">
      <div class="card-cover">${cover}<span class="cover-category">${escapeHtml(row.category_name || categoryLabel(row.category_code))}</span>${row.is_favorite ? '<span class="favorite-star">★</span>' : ''}</div>
      <div class="card-content">
        <div class="card-meta"><span>${escapeHtml(row.reading_initial || '他')}行</span></div>
        <div class="card-player-types">${getPlayerTypes(row.player_count).map((item) => `<span class="chip player">${escapeHtml(item)}</span>`).join('') || '<span class="muted small-text">人数未確認</span>'}</div>
        <h2 class="card-title">${escapeHtml(row.title)}</h2>
        <div class="card-author">${row.author_name ? `サークル：${escapeHtml(row.author_name)}` : 'サークル名未登録'}</div>
        <div class="chips">${chips.join('')}</div>
        <div class="card-footer"><span>${escapeHtml(row.folder_name || '')}</span><span>${row.folder_exists === false ? '未検出' : 'フォルダあり'}</span></div>
      </div>
    </article>`;
  }).join('');
}

function render() {
  renderSidebarCounts();
  const rows = filterRows();
  $('page-title').textContent = currentFilter === 'all' ? (currentCategory === 'all' ? 'すべてのシナリオ' : categoryLabel(currentCategory)) : ({ favorite: 'お気に入り', kp: 'KP済み', pl: 'PL済み', unread: '未読', missing: 'フォルダ未検出' }[currentFilter]);
  $('page-subtitle').textContent = `${rows.length}件 / 登録 ${scenarios.length}件`;
  $('mobile-count').textContent = `${rows.length}件`;
  $('empty-state').classList.toggle('hidden', scenarios.length > 0);
  $('scenario-grid').classList.toggle('hidden', scenarios.length === 0 || rows.length === 0);
  $('no-results').classList.toggle('hidden', scenarios.length === 0 || rows.length > 0);
  renderCards(rows);
}

function initIndexedDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('trpg-archive-local', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveRootHandle(handle) {
  const db = await initIndexedDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'scenario-root');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  rootHandle = handle;
  updateFolderUI();
}

async function loadRootHandle() {
  try {
    const db = await initIndexedDb();
    const handle = await new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readonly');
      const req = tx.objectStore('handles').get('scenario-root');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    rootHandle = handle;
    updateFolderUI();
  } catch (error) {
    console.warn('フォルダハンドルを復元できませんでした', error);
  }
}

function updateFolderUI() {
  $('folder-state').textContent = rootHandle ? `監視フォルダ：${rootHandle.name}` : '監視フォルダ：未設定';
  $('scan-btn').disabled = !rootHandle;
  $('mobile-scan-btn').disabled = !rootHandle;
}

async function chooseRootFolder() {
  if (!('showDirectoryPicker' in window)) {
    setNotice('このブラウザはフォルダ選択に対応していません。PC版ChromeまたはEdgeで開いてください。スマホでは同期済み一覧の閲覧・編集ができます。', 'warn');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'read' });
    await saveRootHandle(handle);
    setNotice(`「${handle.name}」を監視フォルダとして設定しました。「再スキャン」を押すと一覧を更新します。`);
    await scanFolder();
  } catch (error) {
    if (error.name !== 'AbortError') setNotice(`フォルダを選択できませんでした：${error.message}`, 'warn');
  }
}

async function getFolderPermission(handle) {
  let permission = await handle.queryPermission({ mode: 'read' });
  if (permission !== 'granted') permission = await handle.requestPermission({ mode: 'read' });
  return permission;
}

async function readDirectoryEntries(directoryHandle) {
  const entries = [];
  for await (const [name, handle] of directoryHandle.entries()) entries.push({ name, handle });
  return entries;
}

function parseScenarioFolder(folderName) {
  const indexes = ['＿', '_'].map((separator) => folderName.indexOf(separator)).filter((index) => index > 0);
  if (!indexes.length) return { readingInitial: '他', title: folderName.trim() };
  const index = Math.min(...indexes);
  const reading = folderName.slice(0, index).trim();
  const title = folderName.slice(index + 1).trim();
  return { readingInitial: Array.from(reading)[0] || '他', title: title || folderName };
}

async function findThumbnail(directoryHandle) {
  const files = [];
  for (const entry of await readDirectoryEntries(directoryHandle)) {
    if (entry.handle.kind !== 'file') continue;
    const ext = entry.name.split('.').pop()?.toLowerCase();
    if (IMAGE_EXTENSIONS.includes(ext)) files.push(entry);
  }
  if (!files.length) return null;
  files.sort((a, b) => {
    const priority = (name) => /サムネ|表紙|cover|thumbnail|thumb/i.test(name) ? 0 : 1;
    return priority(a.name) - priority(b.name) || a.name.localeCompare(b.name, 'ja');
  });
  const file = await files[0].handle.getFile();
  if (file.size > MAX_THUMBNAIL_BYTES) return { tooLarge: true, name: file.name, size: file.size };
  return { file, name: file.name, lastModified: file.lastModified };
}

function extensionOf(name) {
  const ext = name.split('.').pop()?.toLowerCase() || 'jpg';
  return IMAGE_EXTENSIONS.includes(ext) ? ext : 'jpg';
}

async function uploadThumbnail(row, imageInfo) {
  if (!imageInfo || imageInfo.tooLarge) return row;
  if (row.thumbnail_filename === imageInfo.name && Number(row.thumbnail_last_modified) === Number(imageInfo.lastModified) && row.thumbnail_object_path) return row;
  const objectPath = `${currentUser.id}/${row.id}/cover.${extensionOf(imageInfo.name)}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(objectPath, imageInfo.file, {
    upsert: true,
    contentType: imageInfo.file.type || 'image/jpeg',
    cacheControl: '3600'
  });
  if (uploadError) throw uploadError;
  const update = {
    thumbnail_object_path: objectPath,
    thumbnail_filename: imageInfo.name,
    thumbnail_last_modified: imageInfo.lastModified
  };
  const { data, error } = await supabase.from(TABLE).update(update).eq('id', row.id).eq('user_id', currentUser.id).select().single();
  if (error) throw error;
  if (row.thumbnail_object_path && row.thumbnail_object_path !== objectPath) {
    await supabase.storage.from(BUCKET).remove([row.thumbnail_object_path]);
  }
  return data;
}

async function scanFolder() {
  if (!rootHandle || !currentUser) return;
  const permission = await getFolderPermission(rootHandle);
  if (permission !== 'granted') {
    setNotice('フォルダへのアクセスが許可されていません。「フォルダを選択」から再度選択してください。', 'warn');
    return;
  }
  $('scan-btn').disabled = true;
  $('mobile-scan-btn').disabled = true;
  setNotice('フォルダを読み込んでいます。既存のKP/PL・既読・メモなどは上書きしません。');
  setProgress(2);
  try {
    const rootEntries = await readDirectoryEntries(rootHandle);
    const categoryHandles = new Map();
    const ignoredRootFolders = [];
    const SCANNABLE_CATEGORY_CODES = new Set(['00', '01', '02', '03', '04', '05']);
    for (const entry of rootEntries) {
      if (entry.handle.kind !== 'directory') continue;
      const match = entry.name.match(/^(\d{2})[_＿](.+)$/);
      if (!match) {
        // 直下の通常フォルダは分類フォルダではないため対象外
        ignoredRootFolders.push(entry.name);
        continue;
      }
      const code = match[1];
      // 99_未整理 は現在の6分類に含めない。CSV取込用の仮分類(99)とも区別する。
      if (!SCANNABLE_CATEGORY_CODES.has(code)) {
        ignoredRootFolders.push(entry.name);
        continue;
      }
      const def = CATEGORY_DEFS.find((category) => category.code === code && category.code !== '99');
      if (!def) {
        ignoredRootFolders.push(entry.name);
        continue;
      }
      categoryHandles.set(def.code, { code: def.code, handle: entry.handle, name: entry.name, label: def.name });
    }
    if (!categoryHandles.size) throw new Error('直下に 00_公式シナリオ ～ 05_企画 のフォルダが見つかりません。選択した場所を確認してください。');

    const existingResult = await supabase.from(TABLE).select('*').eq('user_id', currentUser.id).range(0, 4999);
    if (existingResult.error) throw existingResult.error;
    const existing = existingResult.data || [];
    const byKey = new Map(existing.map((row) => [row.folder_key, row]));
    const importedByTitle = new Map();
    for (const row of existing.filter((item) => item.category_code === '99')) {
      const key = normalizeTitle(row.title);
      if (!importedByTitle.has(key)) importedByTitle.set(key, []);
      importedByTitle.get(key).push(row);
    }
    const foundKeys = new Set();
    const foundRows = [];
    let total = 0;
    for (const [, category] of categoryHandles.entries()) {
      const entries = await readDirectoryEntries(category.handle);
      total += entries.filter((entry) => entry.handle.kind === 'directory' && !entry.name.startsWith('.')).length;
    }
    let completed = 0;
    let created = 0;
    let updated = 0;
    let imagesUploaded = 0;
    const oversized = [];

    for (const [, category] of categoryHandles.entries()) {
      const categoryCode = category.code;
      if (!['00', '01', '02', '03', '04', '05'].includes(categoryCode)) {
        throw new Error(`分類コード「${categoryCode}」が不正です。00～05の分類フォルダだけをスキャンできます。`);
      }
      const entries = await readDirectoryEntries(category.handle);
      for (const entry of entries) {
        if (entry.handle.kind !== 'directory' || entry.name.startsWith('.')) continue;
        const parsed = parseScenarioFolder(entry.name);
        const folderKey = `${categoryCode}/${entry.name}`;
        const relativePath = `${category.name}/${entry.name}`;
        foundKeys.add(folderKey);
        const titleMatches = importedByTitle.get(normalizeTitle(parsed.title)) || [];
        const previous = byKey.get(folderKey) || (titleMatches.length === 1 ? titleMatches[0] : null);
        const metadata = {
          folder_key: folderKey,
          category_code: categoryCode,
          category_name: category.label,
          reading_initial: parsed.readingInitial,
          title: parsed.title,
          folder_name: entry.name,
          relative_path: relativePath,
          folder_exists: true
        };
        let row;
        if (previous) {
          const { data, error } = await supabase.from(TABLE).update(metadata).eq('id', previous.id).eq('user_id', currentUser.id).select().single();
          if (error) throw error;
          row = data;
          updated++;
        } else {
          const { data, error } = await supabase.from(TABLE).insert({
            ...metadata,
            user_id: currentUser.id,
            kp_done: false,
            pl_done: false,
            read_status: '未読',
            r_rating: '未確認',
            player_count: '',
            paid_status: '未確認',
            is_favorite: false
          }).select().single();
          if (error) throw error;
          row = data;
          created++;
        }
        const imageInfo = await findThumbnail(entry.handle);
        if (imageInfo?.tooLarge) oversized.push(`${entry.name}（${(imageInfo.size / 1024 / 1024).toFixed(1)}MB）`);
        if (imageInfo && !imageInfo.tooLarge) {
          const changed = row.thumbnail_filename !== imageInfo.name || Number(row.thumbnail_last_modified) !== Number(imageInfo.lastModified) || !row.thumbnail_object_path;
          row = await uploadThumbnail(row, imageInfo);
          if (changed) imagesUploaded++;
        }
        foundRows.push(row);
        completed++;
        setProgress(total ? 5 + (completed / total) * 90 : 95);
      }
    }

    const missing = existing.filter((row) => !foundKeys.has(row.folder_key) && row.folder_exists !== false);
    for (const row of missing) {
      const { error } = await supabase.from(TABLE).update({ folder_exists: false }).eq('id', row.id).eq('user_id', currentUser.id);
      if (error) throw error;
    }

    setProgress(100);
    await loadScenarios();
    const ignoredMessage = ignoredRootFolders.length
      ? ` 対象外の直下フォルダ（${ignoredRootFolders.join('、')}）はスキャンしていません。`
      : '';
    const message = `スキャン完了：新規 ${created}件、既存更新 ${updated}件、フォルダ未検出 ${missing.length}件、サムネイル更新 ${imagesUploaded}件。KP/PL・既読・サークル名・URL・メモは保持しました。${ignoredMessage}`;
    setNotice(message);
    if (oversized.length) setNotice(`${message} 8MBを超えるためサムネイルを取り込まなかったフォルダ：${oversized.slice(0, 5).join('、')}`, 'warn');
    showToast('フォルダのスキャンが完了しました');
  } catch (error) {
    console.error(error);
    setNotice(`スキャンに失敗しました：${error.message}`, 'warn');
  } finally {
    setProgress(0, false);
    $('scan-btn').disabled = !rootHandle;
    $('mobile-scan-btn').disabled = !rootHandle;
  }
}

function openDetails(id) {
  const row = scenarios.find((item) => item.id === id);
  if (!row) return;
  currentEditingId = id;
  $('detail-title').textContent = row.title;
  $('detail-path').textContent = `保存場所：${row.relative_path || '未登録'} / 分類：${row.category_name || categoryLabel(row.category_code)} / かな：${row.reading_initial || '他'}`;
  const selectedPlayers = new Set(getPlayerTypes(row.player_count));
  document.querySelectorAll('input[name="edit-players"]').forEach((el) => { el.checked = selectedPlayers.has(el.value); });
  $('edit-r18').value = row.r_rating || '未確認';
  $('edit-paid').value = row.paid_status || '未確認';
  $('edit-read').value = row.read_status || '未読';
  $('edit-author').value = row.author_name || '';
  $('edit-url').value = row.url || '';
  $('edit-kp').checked = !!row.kp_done;
  $('edit-pl').checked = !!row.pl_done;
  $('edit-favorite').checked = !!row.is_favorite;
  $('edit-memo').value = row.memo || '';
  $('detail-message').textContent = '';
  detailDialog.showModal();
}

async function saveDetails() {
  if (!currentEditingId) return;
  const updates = {
    player_count: PLAYER_OPTIONS.filter((option) => document.querySelector(`input[name="edit-players"][value="${option}"]`)?.checked).join('、'),
    r_rating: $('edit-r18').value,
    paid_status: $('edit-paid').value,
    read_status: $('edit-read').value,
    author_name: $('edit-author').value.trim(),
    url: $('edit-url').value.trim(),
    kp_done: $('edit-kp').checked,
    pl_done: $('edit-pl').checked,
    is_favorite: $('edit-favorite').checked,
    memo: $('edit-memo').value.trim()
  };
  $('save-detail-btn').disabled = true;
  const { error } = await supabase.from(TABLE).update(updates).eq('id', currentEditingId).eq('user_id', currentUser.id);
  $('save-detail-btn').disabled = false;
  if (error) {
    $('detail-message').textContent = `保存できませんでした：${error.message}`;
    return;
  }
  detailDialog.close();
  await loadScenarios();
  showToast('シナリオ情報を保存しました');
}

function normalizeTitle(value) {
  return String(value || '').normalize('NFKC').replace(/[\s　]/g, '').toLocaleLowerCase();
}

function parseCsvText(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell); cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== '')) rows.push(row);
  return rows;
}

function headerKey(value) {
  return String(value || '').normalize('NFKC').replace(/[\s　（）()・＿_：:]/g, '').toLowerCase();
}

function findCsvColumn(record, aliases) {
  const targets = aliases.map(headerKey);
  return Object.keys(record).find((candidate) => targets.includes(headerKey(candidate)));
}

function hasCsvColumn(record, aliases) {
  return findCsvColumn(record, aliases) !== undefined;
}

function findCsvValue(record, aliases) {
  const key = findCsvColumn(record, aliases);
  return key === undefined ? '' : record[key];
}

function parseChecked(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return null;
  if (/^(0|false|no|n|なし|無償|未|未読|×|✕)$/i.test(v)) return false;
  if (/^(1|true|yes|y|あり|有償|有|済|○|〇|✓|✔|☑|チェック)$/i.test(v)) return true;
  return /kp済|pl済|既読/.test(v) ? true : null;
}

function parsePlayerTypes(value) {
  const text = String(value || '').normalize('NFKC').replace(/[\r\n、，,;；|／/・]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const aliases = [
    ['ソロ', /(^|\s)(ソロ|1PL|1人)(?=\s|$)/i],
    ['タイマン', /(^|\s)(タイマン|1対1)(?=\s|$)/i],
    ['2PL', /(^|\s)(2PL|2人)(?=\s|$)/i],
    ['3PL', /(^|\s)(3PL|3人)(?=\s|$)/i],
    ['4PL', /(^|\s)(4PL|4人)(?=\s|$)/i],
    ['5PL', /(^|\s)(5PL|5人)(?=\s|$)/i],
    ['6PL', /(^|\s)(6PL|6人)(?=\s|$)/i],
    ['人数融通有', /人数\s*融通\s*(有|あり|可)|(^|\s)(融通有|人数融通)(?=\s|$)/i]
  ];
  return aliases.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}

function getPlayerColumnValues(record) {
  const combinedAliases = ['人数', 'プレイ人数', 'PL人数', '対応人数', '人数区分', 'プレイヤー人数', 'プレイ可能人数'];
  const combinedColumn = findCsvColumn(record, combinedAliases);
  if (combinedColumn !== undefined) {
    const parsed = parsePlayerTypes(record[combinedColumn]);
    if (parsed.length) return { provided: true, value: parsed.join('、') };
  }
  // 人数ごとに列が分かれているチェックボックス形式にも対応
  const playerColumnAliases = {
    'ソロ': ['ソロ', 'ソロ可', '1PL'],
    'タイマン': ['タイマン', 'タイマン可'],
    '2PL': ['2PL', '2PL可'],
    '3PL': ['3PL', '3PL可'],
    '4PL': ['4PL', '4PL可'],
    '5PL': ['5PL', '5PL可'],
    '6PL': ['6PL', '6PL可'],
    '人数融通有': ['人数融通有', '人数融通あり', '人数融通可', '融通有']
  };
  const selected = [];
  let provided = false;
  for (const [option, aliases] of Object.entries(playerColumnAliases)) {
    const key = findCsvColumn(record, aliases);
    if (key === undefined) continue;
    provided = true;
    if (parseChecked(record[key]) === true) selected.push(option);
  }
  return { provided, value: selected.join('、') };
}

function csvToScenario(record) {
  const title = String(findCsvValue(record, ['シナリオ名', 'タイトル', 'シナリオ', '作品名', 'title', 'name'])).trim();
  if (!title) return null;

  const kanaAliases = ['かな', '読み', 'よみ', '頭文字', '読み仮名'];
  const stateAliases = ['状態', 'プレイ状態', 'ステータス'];
  const kpAliases = ['KP済', 'KP', 'KP済み', 'KP経験', 'KP実施'];
  const plAliases = ['PL済', 'PL', 'PL済み', 'PL経験', 'PL実施'];
  const readAliases = ['既読未読', '既読状態', '読書状態', '既読', '読了状態'];
  const rAliases = ['R指定', 'R', '年齢制限', 'R18', 'レーティング'];
  const paidAliases = ['有償', '有', '有料', '価格区分', '頒布形態'];
  const urlAliases = ['シナリオ場所', 'URL', 'リンク', '配布先', '公開先', '配布URL', '販売URL'];
  const circleAliases = ['サークル名', 'サークル', '頒布元', '発行元', 'circle', 'circle name', '作者名', '作者', '作成者', '著者'];
  const memoAliases = ['メモ', '備考', 'コメント'];

  const kana = String(findCsvValue(record, kanaAliases)).trim();
  const state = String(findCsvValue(record, stateAliases)).trim();
  const kpValue = findCsvValue(record, kpAliases);
  const plValue = findCsvValue(record, plAliases);
  const readValue = String(findCsvValue(record, readAliases)).trim();
  const rValue = String(findCsvValue(record, rAliases)).trim();
  const paidValue = String(findCsvValue(record, paidAliases)).trim();
  const players = getPlayerColumnValues(record);
  const circle = String(findCsvValue(record, circleAliases)).trim();
  const url = String(findCsvValue(record, urlAliases)).trim();
  const memo = String(findCsvValue(record, memoAliases)).trim();

  let rRating = '未確認';
  if (hasCsvColumn(record, rAliases)) {
    if (/なし|対象外|false|no|^0$|不要|×|✕/i.test(rValue) || parseChecked(rValue) === false) rRating = 'なし';
    else if (parseChecked(rValue) === true || /r.?18|r.?15|あり/i.test(rValue)) rRating = 'あり';
  }
  let paidStatus = '未確認';
  if (hasCsvColumn(record, paidAliases)) {
    if (/無償|無料|なし|false|no|^0$|×|✕/i.test(paidValue) || parseChecked(paidValue) === false) paidStatus = '無償';
    else if (/有償|有料|販売|頒布|true|yes|^1$|^有$/i.test(paidValue) || parseChecked(paidValue) === true) paidStatus = '有償';
  }
  const readStatus = /未読/.test(readValue) || /未読/.test(state) ? '未読' : (/既読/.test(readValue) || /既読/.test(state) ? '既読' : '未読');
  const kpColumnPresent = hasCsvColumn(record, kpAliases);
  const plColumnPresent = hasCsvColumn(record, plAliases);
  const stateHasKp = /KP済/.test(state);
  const stateHasPl = /PL済/.test(state);
  const kpChecked = parseChecked(kpValue);
  const plChecked = parseChecked(plValue);

  return {
    title,
    reading_initial: Array.from(kana || '他')[0] || '他',
    player_count: players.value,
    r_rating: rRating,
    paid_status: paidStatus,
    read_status: readStatus,
    kp_done: kpChecked === true || stateHasKp,
    pl_done: plChecked === true || stateHasPl,
    url,
    author_name: circle,
    memo,
    __provided: {
      reading_initial: hasCsvColumn(record, kanaAliases) && !!kana,
      player_count: players.provided,
      r_rating: hasCsvColumn(record, rAliases) && rRating !== '未確認',
      paid_status: hasCsvColumn(record, paidAliases) && paidStatus !== '未確認',
      read_status: (hasCsvColumn(record, readAliases) && !!readValue) || /既読|未読/.test(state),
      kp_done: (kpColumnPresent && kpChecked !== null) || stateHasKp || /KP済/.test(state),
      pl_done: (plColumnPresent && plChecked !== null) || stateHasPl || /PL済/.test(state),
      url: hasCsvColumn(record, urlAliases) && !!url,
      author_name: hasCsvColumn(record, circleAliases) && !!circle,
      memo: hasCsvColumn(record, memoAliases) && !!memo
    }
  };
}

async function importCsvFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || !currentUser) return;
  try {
    const rows = parseCsvText(await file.text());
    if (rows.length < 2) throw new Error('CSVにデータ行がありません。');
    const headers = rows[0].map((value) => value.trim());
    const headerRecord = Object.fromEntries(headers.map((header) => [header, '']));
    if (!hasCsvColumn(headerRecord, ['シナリオ名', 'タイトル', 'シナリオ', '作品名', 'title', 'name'])) {
      throw new Error('シナリオ名に相当する列が見つかりません。列名を「シナリオ名」または「タイトル」にしてください。');
    }
    const dataRows = rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
    const imported = dataRows.map(csvToScenario).filter(Boolean);
    if (!imported.length) throw new Error('取り込めるシナリオ名がありませんでした。');

    const { data: existing, error: fetchError } = await supabase.from(TABLE).select('*').eq('user_id', currentUser.id).range(0, 4999);
    if (fetchError) throw fetchError;
    const byTitle = new Map();
    for (const row of existing || []) {
      const key = normalizeTitle(row.title);
      if (!byTitle.has(key)) byTitle.set(key, []);
      byTitle.get(key).push(row);
    }
    let updated = 0;
    let created = 0;
    let ambiguous = 0;
    for (const item of imported) {
      const matches = byTitle.get(normalizeTitle(item.title)) || [];
      if (matches.length === 1) {
        const old = matches[0];
        const updates = {};
        for (const field of ['reading_initial', 'player_count', 'r_rating', 'paid_status', 'read_status', 'kp_done', 'pl_done', 'url', 'author_name', 'memo']) {
          const value = item[field];
          if (item.__provided[field] && value !== '' && value !== null && value !== undefined) updates[field] = value;
        }
        if (Object.keys(updates).length) {
          const { error } = await supabase.from(TABLE).update(updates).eq('id', old.id).eq('user_id', currentUser.id);
          if (error) throw error;
          updated++;
        }
      } else {
        if (matches.length > 1) ambiguous++;
        const folderKey = `csv/${crypto.randomUUID()}`;
        const payload = {
          user_id: currentUser.id,
          folder_key: folderKey,
          category_code: '99',
          category_name: '未分類（CSV取込）',
          folder_name: item.title,
          relative_path: 'CSV取り込み（フォルダ未紐付け）',
          folder_exists: false,
          title: item.title,
          is_favorite: false
        };
        for (const field of ['reading_initial', 'player_count', 'r_rating', 'paid_status', 'read_status', 'kp_done', 'pl_done', 'url', 'author_name', 'memo']) {
          if (item.__provided[field]) payload[field] = item[field];
        }
        const { error } = await supabase.from(TABLE).insert(payload);
        if (error) throw error;
        created++;
      }
    }
    await loadScenarios();
    const presentLabels = [];
    if (hasCsvColumn(headerRecord, ['人数', 'プレイ人数', 'PL人数', '対応人数', '人数区分', 'プレイヤー人数', 'プレイ可能人数']) || ['ソロ', 'タイマン', '2PL', '3PL', '4PL', '5PL', '6PL', '人数融通有'].some((key) => hasCsvColumn(headerRecord, [key]))) presentLabels.push('人数');
    if (hasCsvColumn(headerRecord, ['R指定', 'R', '年齢制限', 'R18', 'レーティング'])) presentLabels.push('R指定');
    if (hasCsvColumn(headerRecord, ['有償', '有', '有料', '価格区分', '頒布形態'])) presentLabels.push('有償・無償');
    if (hasCsvColumn(headerRecord, ['サークル名', 'サークル', '頒布元', '発行元', 'circle', 'circle name', '作者名', '作者', '作成者', '著者'])) presentLabels.push('サークル名');
    const optionalNote = presentLabels.length ? ` 認識した任意項目：${presentLabels.join('・')}。` : ' 人数・R指定・有償・サークル名などの任意列は見つからなかったため、既存情報を変更していません。';
    setNotice(`CSV取り込み完了：既存データ更新 ${updated}件、新規登録 ${created}件。列のない項目は空欄で上書きせず、既存情報を保持します。${optionalNote}${ambiguous ? ` 同名の既存データが複数あるため、新規登録にしたものが${ambiguous}件あります。` : ''}`);
    showToast('CSVを取り込みました');
  } catch (error) {
    setNotice(`CSV取り込みに失敗しました：${error.message}`, 'warn');
  }
}

function exportJson() {
  const payload = scenarios.map(({ thumbnail_url, ...row }) => row);
  const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), scenarios: payload }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `trpg-archive-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast('JSONを書き出しました');
}

function bindEvents() {
  $('login-btn').addEventListener('click', signIn);
  $('signup-btn').addEventListener('click', signUp);
  $('auth-password').addEventListener('keydown', (event) => { if (event.key === 'Enter') signIn(); });
  $('logout-btn').addEventListener('click', signOut);
  $('choose-folder-btn').addEventListener('click', chooseRootFolder);
  $('empty-choose-btn').addEventListener('click', chooseRootFolder);
  $('scan-btn').addEventListener('click', scanFolder);
  $('mobile-scan-btn').addEventListener('click', scanFolder);
  $('refresh-btn').addEventListener('click', loadScenarios);
  $('export-btn').addEventListener('click', exportJson);
  $('import-csv-btn').addEventListener('click', () => $('csv-file').click());
  $('csv-file').addEventListener('change', importCsvFile);
  $('save-detail-btn').addEventListener('click', saveDetails);
  $('open-folder-btn').addEventListener('click', async () => {
    const row = scenarios.find((item) => item.id === currentEditingId);
    if (!row) return;
    try {
      await navigator.clipboard.writeText(row.relative_path || '');
      $('detail-message').textContent = '保存場所をクリップボードにコピーしました。';
    } catch {
      $('detail-message').textContent = `保存場所：${row.relative_path || '未登録'}`;
    }
  });
  $('search').addEventListener('input', render);
  $('sort-select').addEventListener('change', render);
  ['filter-r18', 'filter-paid', 'filter-unread'].forEach((id) => $(id).addEventListener('change', render));
  document.querySelectorAll('input[name="players"]').forEach((el) => el.addEventListener('change', render));
  document.querySelectorAll('.filter-link').forEach((button) => button.addEventListener('click', () => {
    currentFilter = button.dataset.filter;
    currentCategory = 'all';
    render();
    document.body.classList.remove('mobile-filter-open');
  }));
  $('category-filters').addEventListener('click', (event) => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    currentCategory = currentCategory === button.dataset.category ? 'all' : button.dataset.category;
    currentFilter = 'all';
    render();
    document.body.classList.remove('mobile-filter-open');
  });
  $('scenario-grid').addEventListener('click', (event) => {
    const card = event.target.closest('[data-id]');
    if (card) openDetails(card.dataset.id);
  });
  $('scenario-grid').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('[data-id]');
    if (card) { event.preventDefault(); openDetails(card.dataset.id); }
  });
  $('mobile-filter-toggle').addEventListener('click', () => document.body.classList.toggle('mobile-filter-open'));
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault(); $('search').focus();
    }
  });
}

async function init() {
  bindEvents();
  if (!configIsReady()) {
    showAuthMessage('config.js にSupabase URLとanon/publishable keyを設定してください。READMEの導入手順を参照してください。', true);
    $('login-btn').disabled = true;
    $('signup-btn').disabled = true;
    return;
  }
  supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
  await loadRootHandle();
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user) showApp(session.user);
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) showApp(session.user);
    else {
      currentUser = null;
      appScreen.classList.add('hidden');
      authScreen.classList.remove('hidden');
    }
  });
}

init().catch((error) => {
  console.error(error);
  showAuthMessage(`初期化に失敗しました：${error.message}`, true);
});
