/* ---------------------------------------------------------
   Habit Tracker — app logic
   Plain vanilla JS. No frameworks, no build step.
   Data lives in localStorage; nothing leaves the browser.
   --------------------------------------------------------- */

(function () {
  'use strict';

  var STORAGE_KEY = 'habit-tracker:v1';
  var DEFAULT_ICON = '\u{1F31F}'; // 🌟
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var MAX_ICON_GRAPHS = 8;

  /* ---------------- date helpers (local calendar days) ---------------- */

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function toKey(d) {
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function parseKey(key) {
    var parts = key.split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function addDays(d, n) {
    var copy = startOfDay(d);
    copy.setDate(copy.getDate() + n);
    return copy;
  }

  function daysBetween(a, b) {
    // Math.round absorbs DST shifts so calendar days count as exactly 1.
    return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
  }

  function today() {
    return startOfDay(new Date());
  }

  /* ---------------- grapheme-safe icon text ----------------
     Emoji can span several UTF-16 code units (surrogate pairs) and
     several code points (ZWJ sequences, flags, skin tones). A naive
     .slice(0, 8) can cut a pair in half and leave a lone surrogate
     behind, which renders as a broken glyph, so icons are truncated by
     grapheme cluster instead. */

  var graphemeSegmenter =
    typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null;

  function isLoneSurrogate(str) {
    if (str.length !== 1) return false;
    var code = str.charCodeAt(0);
    return code >= 0xd800 && code <= 0xdfff;
  }

  function toGraphemes(str) {
    str = String(str);
    var parts = null;
    if (graphemeSegmenter) {
      try {
        parts = Array.from(graphemeSegmenter.segment(str), function (part) {
          return part.segment;
        });
      } catch (err) {
        parts = null; // fall back to code points below
      }
    }
    if (!parts) {
      parts = [];
      for (var i = 0; i < str.length; i++) {
        var code = str.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
          var next = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
          if (next >= 0xdc00 && next <= 0xdfff) {
            parts.push(str.slice(i, i + 2));
            i++;
            continue;
          }
          continue; // lone high surrogate -> drop
        }
        if (code >= 0xdc00 && code <= 0xdfff) continue; // lone low surrogate -> drop
        parts.push(str.charAt(i));
      }
    }
    var out = [];
    for (var j = 0; j < parts.length; j++) {
      if (!isLoneSurrogate(parts[j])) out.push(parts[j]);
    }
    return out;
  }

  function truncateGraphemes(str, max) {
    var parts = toGraphemes(str);
    return parts.length > max ? parts.slice(0, max).join('') : parts.join('');
  }

  function sanitizeIcon(value) {
    if (typeof value !== 'string') return '';
    return truncateGraphemes(value.trim(), MAX_ICON_GRAPHS);
  }

  /* ---------------- streak logic ---------------- */

  function validKeys(habit) {
    var keys = Object.keys(habit.done || {});
    var out = [];
    for (var i = 0; i < keys.length; i++) {
      if (DATE_RE.test(keys[i]) && habit.done[keys[i]]) out.push(keys[i]);
    }
    return out.sort();
  }

  // Consecutive calendar days completed, ending today.
  // Today not checked in yet is not a "missed day" until tomorrow,
  // so we count back from yesterday in that case.
  function currentStreak(habit, ref) {
    var keys = validKeys(habit);
    var set = Object.create(null);
    for (var i = 0; i < keys.length; i++) set[keys[i]] = true;

    var count = 0;
    var cursor = startOfDay(ref || today());
    if (!set[toKey(cursor)]) cursor = addDays(cursor, -1);
    while (set[toKey(cursor)]) {
      count++;
      cursor = addDays(cursor, -1);
    }
    return count;
  }

  // Longest run of consecutive days ever completed. Kept forever.
  function longestStreak(habit) {
    var keys = validKeys(habit);
    if (!keys.length) return 0;
    var best = 1;
    var run = 1;
    for (var i = 1; i < keys.length; i++) {
      if (daysBetween(parseKey(keys[i - 1]), parseKey(keys[i])) === 1) {
        run++;
        if (run > best) best = run;
      } else {
        run = 1;
      }
    }
    return best;
  }

  function dayWord(n) {
    return n === 1 ? '1 day' : n + ' days';
  }

  /* Signature touch: a small celebration when today's check-in lands on a
     round milestone — full weeks (7, 14, 21, …) and tens (10, 20, 30, …).
     It only shows on the milestone day itself, and only once the day is
     actually checked in, so the card earns it. */
  function milestoneLabel(n, doneToday) {
    if (!doneToday || n < 7) return null;
    if (n % 7 === 0) {
      var weeks = n / 7;
      return n + '-day milestone — ' + (weeks === 1 ? 'a full week!' : weeks + ' full weeks!');
    }
    if (n % 10 === 0) return n + '-day milestone — keep it rolling!';
    return null;
  }

  /* ---------------- storage ---------------- */

  var memoryFallback = Object.create(null);
  var storage = (function () {
    try {
      var probe = '__habit_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch (err) {
      // file:// in some browsers, private mode, quota issues -> in-memory only
      return {
        getItem: function (k) {
          return k in memoryFallback ? memoryFallback[k] : null;
        },
        setItem: function (k, v) {
          memoryFallback[k] = String(v);
        },
        removeItem: function (k) {
          delete memoryFallback[k];
        }
      };
    }
  })();

  function genId() {
    return 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function load() {
    var fallback = { habits: [] };
    try {
      var raw = storage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      var data = JSON.parse(raw);
      if (!data || !Array.isArray(data.habits)) return fallback;

      var habits = [];
      for (var i = 0; i < data.habits.length; i++) {
        var h = data.habits[i];
        if (!h || typeof h.name !== 'string' || !h.name.trim()) continue;

        var done = Object.create(null);
        if (h.done && typeof h.done === 'object') {
          var keys = Object.keys(h.done);
          for (var j = 0; j < keys.length; j++) {
            if (DATE_RE.test(keys[j]) && h.done[keys[j]]) done[keys[j]] = true;
          }
        }
        var icon = sanitizeIcon(h.icon);
        habits.push({
          id: typeof h.id === 'string' && h.id ? h.id : genId(),
          name: h.name.trim().slice(0, 60),
          icon: icon || DEFAULT_ICON,
          done: done
        });
      }
      return { habits: habits };
    } catch (err) {
      console.warn('Habit Tracker: could not load saved data.', err);
      return fallback;
    }
  }

  function save() {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ habits: state.habits }));
    } catch (err) {
      console.warn('Habit Tracker: could not save data.', err);
    }
  }

  /* ---------------- tiny DOM helpers ---------------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(label, action, className) {
    var b = el('button', className, label);
    b.type = 'button';
    b.dataset.action = action;
    return b;
  }

  var TRASH_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="3 6 5 6 21 6"></polyline>' +
    '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>' +
    '<path d="M10 11v6M14 11v6"></path>' +
    '<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>' +
    '</svg>';

  /* ---------------- state + rendering ---------------- */

  var state = load();

  var els = {};
  var todayDate = today();

  function cacheDom() {
    els.form = document.getElementById('habitForm');
    els.name = document.getElementById('habitName');
    els.icon = document.getElementById('habitIcon');
    els.error = document.getElementById('formError');
    els.list = document.getElementById('habitList');
    els.empty = document.getElementById('emptyState');
    els.emptyCta = document.getElementById('emptyCta');
    els.summary = document.getElementById('summary');
    els.todayLabel = document.getElementById('todayLabel');
    els.live = document.getElementById('liveStatus');
  }

  function announce(message) {
    if (els.live) els.live.textContent = message;
  }

  function renderTodayLabel() {
    els.todayLabel.textContent =
      'Today · ' +
      todayDate.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });
  }

  /* "Today" used to be frozen at page load. Re-derive it whenever the page
     regains focus or visibility so a tab left open past midnight (or across
     a DST boundary) still shows the right day and week strip. */
  function syncToday() {
    var fresh = today();
    if (toKey(fresh) === toKey(todayDate)) return false;
    todayDate = fresh;
    renderTodayLabel();
    renderAllPreservingFocus();
    announce(
      'Now showing ' +
        todayDate.toLocaleDateString(undefined, {
          weekday: 'long',
          month: 'long',
          day: 'numeric'
        }) +
        '.'
    );
    return true;
  }

  function onWake() {
    if (document.visibilityState && document.visibilityState !== 'visible') return;
    syncToday();
  }

  function isDone(habit, key) {
    return !!(habit.done && habit.done[key]);
  }

  function weekLabel(habit) {
    var parts = [];
    for (var i = 6; i >= 0; i--) {
      var d = addDays(today(), -i);
      var done = isDone(habit, toKey(d));
      parts.push(
        d.toLocaleDateString(undefined, { weekday: 'long' }) +
          ': ' +
          (done ? 'done' : i === 0 ? 'not yet today' : 'missed')
      );
    }
    return 'Last 7 days — ' + parts.join(', ');
  }

  function renderHabit(habit) {
    var key = toKey(today());
    var doneToday = isDone(habit, key);
    var cur = currentStreak(habit);
    var best = longestStreak(habit);

    var li = el('li', 'habit-card');
    li.dataset.id = habit.id;

    /* head: icon, name, streaks, delete */
    var head = el('div', 'habit-head');

    var icon = el('span', 'habit-icon', habit.icon);
    icon.setAttribute('aria-hidden', 'true');

    var info = el('div', 'habit-info');
    info.appendChild(el('h3', 'habit-name', habit.name));
    var meta = el('div', 'habit-meta');
    meta.appendChild(el('span', 'badge badge-streak', '🔥 ' + dayWord(cur)));
    meta.appendChild(el('span', 'badge badge-best', '🏆 Longest: ' + dayWord(best)));
    info.appendChild(meta);

    var del = button('Delete habit', 'delete-start', 'icon-btn delete-btn');
    del.setAttribute('aria-label', 'Delete habit ' + habit.name);
    del.innerHTML = TRASH_SVG;

    head.appendChild(icon);
    head.appendChild(info);
    head.appendChild(del);
    li.appendChild(head);

    /* streak milestone celebration (signature touch): check-in day only */
    var milestone = milestoneLabel(cur, doneToday);
    if (milestone) {
      li.appendChild(el('p', 'milestone', '🎉 ' + milestone));
    }

    /* streak-at-risk nudge: only when there is a streak left to lose */
    if (!doneToday && cur > 0) {
      li.appendChild(
        el(
          'p',
          'at-risk',
          '🔥 Streak at risk — check in today to keep your ' + cur + '-day streak.'
        )
      );
    }

    /* check-in */
    var check = button(
      doneToday ? '✓ Done today' : 'Done today',
      'toggle',
      'check-btn' + (doneToday ? ' is-done' : '')
    );
    check.setAttribute('aria-pressed', doneToday ? 'true' : 'false');
    li.appendChild(check);

    /* week view */
    var week = el('div', 'week');
    week.setAttribute('role', 'group');
    week.setAttribute('aria-label', weekLabel(habit));
    for (var i = 6; i >= 0; i--) {
      var d = addDays(today(), -i);
      var k = toKey(d);
      var cellDone = isDone(habit, k);
      var cell = el('div', 'day-cell');
      if (i === 0) cell.classList.add('is-today');
      if (cellDone) cell.classList.add('is-done');
      cell.appendChild(
        el(
          'span',
          'day-letter',
          d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2)
        )
      );
      var box = el('span', 'day-box');
      if (cellDone) {
        var mark = el('span', 'day-mark', '✓');
        mark.setAttribute('aria-hidden', 'true');
        box.appendChild(mark);
      }
      cell.appendChild(box);
      cell.title =
        d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) +
        ' — ' +
        (cellDone ? 'done' : i === 0 ? 'today, not done yet' : 'missed');
      week.appendChild(cell);
    }
    li.appendChild(week);

    /* delete confirmation (hidden until requested) */
    var confirmBox = el('div', 'delete-confirm');
    confirmBox.hidden = true;
    confirmBox.appendChild(
      el('p', 'confirm-text', 'Delete “' + habit.name + '”? This cannot be undone.')
    );
    var actions = el('div', 'confirm-actions');
    actions.appendChild(button('Cancel', 'delete-cancel', 'btn btn-ghost btn-sm'));
    actions.appendChild(button('Delete', 'delete-confirm', 'btn btn-danger btn-sm'));
    confirmBox.appendChild(actions);
    li.appendChild(confirmBox);

    return li;
  }

  function renderAll() {
    els.list.textContent = '';
    for (var i = 0; i < state.habits.length; i++) {
      els.list.appendChild(renderHabit(state.habits[i]));
    }
    var empty = state.habits.length === 0;
    els.empty.hidden = !empty;
    els.list.hidden = empty;
    renderSummary();
  }

  // Re-render everything, restoring keyboard focus to the equivalent control
  // so a background-tab date rollover never strands keyboard users.
  function renderAllPreservingFocus() {
    var active = document.activeElement;
    var card = active && active.closest ? active.closest('.habit-card') : null;
    var id = card ? card.dataset.id : null;
    var action = active && active.dataset ? active.dataset.action : null;
    renderAll();
    if (!id || !action) return;
    var fresh = els.list.querySelector('.habit-card[data-id="' + id + '"]');
    var target = fresh ? fresh.querySelector('[data-action="' + action + '"]') : null;
    if (target) target.focus();
  }

  // Re-render a single card in place, keeping focus where it was.
  function refreshCard(habit) {
    var old = els.list.querySelector('.habit-card[data-id="' + habit.id + '"]');
    if (!old) return renderAll();
    var hadFocus = old.contains(document.activeElement);
    var fresh = renderHabit(habit);
    old.replaceWith(fresh);
    if (hadFocus) {
      var target = fresh.querySelector('.check-btn') || fresh.querySelector('.delete-btn');
      if (target) target.focus();
    }
    renderSummary();
  }

  function renderSummary() {
    if (!state.habits.length) {
      els.summary.hidden = true;
      return;
    }
    var key = toKey(today());
    var doneCount = 0;
    var atRiskCount = 0;
    for (var i = 0; i < state.habits.length; i++) {
      if (isDone(state.habits[i], key)) {
        doneCount++;
      } else if (currentStreak(state.habits[i]) > 0) {
        atRiskCount++;
      }
    }
    els.summary.textContent =
      state.habits.length +
      (state.habits.length === 1 ? ' habit' : ' habits') +
      ' · ' +
      doneCount +
      ' done today' +
      (atRiskCount
        ? ' · ' +
          atRiskCount +
          (atRiskCount === 1 ? ' streak at risk' : ' streaks at risk')
        : '');
    els.summary.hidden = false;
  }

  function findHabit(id) {
    for (var i = 0; i < state.habits.length; i++) {
      if (state.habits[i].id === id) return state.habits[i];
    }
    return null;
  }

  /* ---------------- actions ---------------- */

  function addHabit(name, icon) {
    var safeIcon = sanitizeIcon(icon);
    state.habits.push({
      id: genId(),
      name: name.slice(0, 60),
      icon: safeIcon || DEFAULT_ICON,
      done: Object.create(null)
    });
    save();
    renderAll();
    announce(name + ' added.');
  }

  function toggleHabit(habit) {
    var key = toKey(today());
    var nowDone;
    if (habit.done[key]) {
      delete habit.done[key];
      nowDone = false;
    } else {
      habit.done[key] = true;
      nowDone = true;
    }
    save();
    refreshCard(habit);
    announce(
      habit.name +
        (nowDone ? ' marked done for today.' : ' unchecked for today.') +
        ' Current streak: ' +
        dayWord(currentStreak(habit)) +
        '.'
    );
  }

  function deleteHabit(habit) {
    state.habits = state.habits.filter(function (h) {
      return h.id !== habit.id;
    });
    save();
    renderAll();
    announce(habit.name + ' deleted.');
    els.name.focus();
  }

  function openDeleteConfirm(card) {
    var box = card.querySelector('.delete-confirm');
    if (!box) return;
    box.hidden = false;
    var confirmBtn = box.querySelector('.delete-confirm [data-action="delete-confirm"]');
    if (confirmBtn) confirmBtn.focus();
  }

  function closeDeleteConfirm(card) {
    var box = card.querySelector('.delete-confirm');
    if (!box || box.hidden) return false;
    box.hidden = true;
    var delBtn = card.querySelector('.delete-btn');
    if (delBtn) delBtn.focus();
    return true;
  }

  /* ---------------- events ---------------- */

  function showFormError(show) {
    els.error.hidden = !show;
    els.name.classList.toggle('is-invalid', show);
    els.name.setAttribute('aria-invalid', show ? 'true' : 'false');
  }

  function onSubmit(e) {
    e.preventDefault();
    var name = els.name.value.trim();
    if (!name) {
      showFormError(true);
      els.name.focus();
      return;
    }
    showFormError(false);
    var icon = els.icon.value.trim();
    addHabit(name, icon);
    els.name.value = '';
    els.icon.value = '';
    els.name.focus();
  }

  function onListClick(e) {
    var actionEl = e.target.closest ? e.target.closest('[data-action]') : null;
    if (!actionEl) return;
    var card = actionEl.closest('.habit-card');
    if (!card) return;
    var habit = findHabit(card.dataset.id);
    if (!habit) return;

    switch (actionEl.dataset.action) {
      case 'toggle':
        toggleHabit(habit);
        break;
      case 'delete-start':
        openDeleteConfirm(card);
        break;
      case 'delete-cancel':
        closeDeleteConfirm(card);
        break;
      case 'delete-confirm':
        deleteHabit(habit);
        break;
    }
  }

  function onKeydown(e) {
    if (e.key !== 'Escape') return;
    var card = document.querySelector('.habit-card .delete-confirm:not([hidden])');
    if (card) closeDeleteConfirm(card.closest('.habit-card'));
  }

  function init() {
    cacheDom();

    renderTodayLabel();

    els.form.addEventListener('submit', onSubmit);
    els.name.addEventListener('input', function () {
      if (!els.error.hidden && els.name.value.trim()) showFormError(false);
    });
    // Browsers cap `maxlength` in code units, so a paste can leave a split
    // surrogate pair; normalise on the way out of the field.
    els.icon.addEventListener('change', function () {
      var safe = sanitizeIcon(els.icon.value);
      if (safe !== els.icon.value) els.icon.value = safe;
    });
    els.list.addEventListener('click', onListClick);
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    window.addEventListener('pageshow', onWake);
    els.emptyCta.addEventListener('click', function () {
      els.name.focus();
      if (els.name.scrollIntoView) {
        els.name.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });

    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* exposed for debugging and automated tests */
  if (typeof window !== 'undefined') {
    window.HabitTracker = {
      currentStreak: currentStreak,
      longestStreak: longestStreak,
      toKey: toKey,
      addDays: addDays,
      addHabit: addHabit,
      toggleHabit: toggleHabit,
      deleteHabit: deleteHabit,
      truncateGraphemes: truncateGraphemes,
      sanitizeIcon: sanitizeIcon,
      syncToday: syncToday,
      milestoneLabel: milestoneLabel,
      getState: function () {
        return state;
      }
    };
  }
})();
