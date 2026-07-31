
        import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
        import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js";
        import {
            getDatabase,
            ref as rtdbRef,
            get as rtdbGet,
            set as rtdbSet,
            onValue as rtdbOnValue,
            onDisconnect as rtdbOnDisconnect,
            remove as rtdbRemove,
            runTransaction as rtdbRunTransaction
        } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js";

        const firebaseConfig = {
            apiKey: "AIzaSyDwV_bSA5E55iFH9AXlbLLYf1SP1OgGw6g",
            authDomain: "clyraplay.firebaseapp.com",
            projectId: "clyraplay",
            storageBucket: "clyraplay.firebasestorage.app",
            messagingSenderId: "741083101755",
            appId: "1:741083101755:web:87b35920172d158db17a1e",
            measurementId: "G-V2DPZFL6HQ"
        };

        const app = initializeApp(firebaseConfig);

        try {
            getAnalytics(app);
        } catch (err) {}
        const rtdb = getDatabase(app);

        const sessionIdKey = "clyraplay_session_id";
        const presenceRootName = "presenceSessions";
        const presenceTimeoutMs = 15000;
        const heartbeatMs = 5000;
        const countCache = Object.create(null);
        const openGuardKey = "clyraplay_open_guard";
        const openGuardTtlMs = 120000;
        let presenceInitialized = false;
        let presenceHeartbeat = null;
        let presenceWriteRef = null;

        function readOpenGuardState() {
            try {
                var raw = sessionStorage.getItem(openGuardKey);
                var data = raw ? JSON.parse(raw) : {};
                return data && typeof data === "object" ? data : {};
            } catch (err) {
                return {};
            }
        }

        function writeOpenGuardState(state) {
            try {
                sessionStorage.setItem(openGuardKey, JSON.stringify(state || {}));
            } catch (err) {}
        }

        function hasRecentlyOpened(cacheKey) {
            var state = readOpenGuardState();
            var entry = state[cacheKey];
            if (!entry || typeof entry !== "object") return false;

            var openedAt = safeNumber(entry.openedAt, 0);
            var count = safeNumber(entry.count, 0);

            if (!openedAt) return false;
            if (Date.now() - openedAt > openGuardTtlMs) return false;
            return count > 0;
        }

        function markRecentlyOpened(cacheKey) {
            var state = readOpenGuardState();
            state[cacheKey] = {
                openedAt: Date.now(),
                count: 1
            };
            writeOpenGuardState(state);
        }

        function getSessionId() {
            let sessionId = sessionStorage.getItem(sessionIdKey);
            if (!sessionId) {
                sessionId = "sess_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
                sessionStorage.setItem(sessionIdKey, sessionId);
            }
            return sessionId;
        }

        function safeNumber(value, fallback) {
            var num = Number(value);
            return isNaN(num) ? (typeof fallback === "number" ? fallback : 0) : num;
        }

        function slugify(value) {
            return String(value || "")
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .toLowerCase()
                .trim()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "");
        }


        function resolveContentInfo(type, itemOrKey) {
            if (typeof itemOrKey === "string") {
                return {
                    key: itemOrKey,
                    title: itemOrKey
                };
            }

            var item = itemOrKey || {};
            var rawTitle = type === "comic" ?
                (item.text || item.title || item.link || item.src || "comic") :
                (item.name || item.title || item.image || "game");

            return {
                key: getContentKey(type, item),
                title: type === "comic" ?
                    formatTitleCase(item.text || item.title || rawTitle) :
                    formatTitleCase(item.name || item.title || rawTitle)
            };
        }

        function getContentKey(type, item) {
            if (type === "comic") {
                return slugify(item && (item.link || item.text || item.title || item.src || ""));
            }
            return slugify(item && (item.name || item.title || item.image || ""));
        }

        function getDocId(type, key) {
            return type + "::" + key;
        }

        function getViewRef(type, key) {
            return rtdbRef(rtdb, "contentViews/" + type + "/" + key);
        }

        function setBadgeValue(badge, value) {
            if (!badge) return;
            var span = badge.querySelector("span");
            if (span) span.textContent = String(value);
        }

        function bindCounter(card, type, key, badge) {
            var cacheKey = getDocId(type, key);
            var ref = getViewRef(type, key);

            rtdbOnValue(ref, function(snapshot) {
                var data = snapshot.val() || {};
                var value = safeNumber(data.count, 0);
                countCache[cacheKey] = value;
                setBadgeValue(badge, value);
                card.dataset.userCountLoaded = "1";
            }, function() {
                setBadgeValue(badge, countCache[cacheKey] || 0);
            });
        }

        function refreshCounterByKey(type, key) {
            const cacheKey = getDocId(type, key);
            document.querySelectorAll('[data-content-key="' + cacheKey + '"] .card-user-badge').forEach(function(badge) {
                setBadgeValue(badge, countCache[cacheKey] || 0);
            });
        }

        async function recordOpen(type, itemOrKey) {
            const info = resolveContentInfo(type, itemOrKey);
            const cacheKey = getDocId(type, info.key);
            const ref = getViewRef(type, info.key);

            if (hasRecentlyOpened(cacheKey)) {
                return;
            }

            markRecentlyOpened(cacheKey);

            try {
                await rtdbRunTransaction(ref, function(current) {
                    var data = current && typeof current === "object" ? current : {};
                    var currentCount = safeNumber(data.count, 0);

                    return {
                        count: currentCount + 1,
                        type: type,
                        key: info.key,
                        title: info.title,
                        slug: info.key,
                        updatedAt: Date.now(),
                        lastOpenedAt: Date.now()
                    };
                });
            } catch (err) {
                try {
                    await rtdbSet(ref, {
                        count: 1,
                        type: type,
                        key: info.key,
                        title: info.title,
                        slug: info.key,
                        updatedAt: Date.now(),
                        lastOpenedAt: Date.now()
                    });
                } catch (e) {}
            }

            try {
                const snap = await rtdbGet(ref);
                const data = snap && typeof snap.val === "function" ? (snap.val() || {}) : {};
                countCache[cacheKey] = safeNumber(data.count, 0);
            } catch (e) {
                // Mantiene el valor anterior hasta que onValue sincronice.
            }

            refreshCounterByKey(type, info.key);
        }

        function updateVisibleCounters() {
            const elements = document.querySelectorAll('[data-content-key]');
            const seen = Object.create(null);

            for (let i = 0; i < elements.length; i++) {
                const key = elements[i].getAttribute('data-content-key');
                if (!key || seen[key]) continue;
                seen[key] = true;

                const badge = elements[i].querySelector('.card-user-badge');
                if (badge && Object.prototype.hasOwnProperty.call(countCache, key)) {
                    setBadgeValue(badge, countCache[key]);
                }
            }
        }

        function updateActiveUsersCount(value) {
            const el = document.getElementById("active-users-count");
            if (el) {
                el.textContent = String(value);
            }
        }

        function writePresence() {
            if (!presenceWriteRef) return;
            return rtdbSet(presenceWriteRef, {
                sessionId: getSessionId(),
                page: "ClyraPlay",
                lastSeen: Date.now(),
                title: document.title || "ClyraPlay",
                hidden: !!document.hidden
            });
        }

        function startPresence() {
            if (presenceInitialized) return;
            presenceInitialized = true;

            const sessionId = getSessionId();
            presenceWriteRef = rtdbRef(rtdb, presenceRootName + "/" + sessionId);

            const connectedRef = rtdbRef(rtdb, ".info/connected");
            rtdbOnValue(connectedRef, function(snap) {
                if (snap.val() === true) {
                    writePresence();
                    try {
                        rtdbOnDisconnect(presenceWriteRef).remove();
                    } catch (err) {}
                    if (presenceHeartbeat) clearInterval(presenceHeartbeat);
                    presenceHeartbeat = setInterval(writePresence, heartbeatMs);
                } else {
                    if (presenceHeartbeat) {
                        clearInterval(presenceHeartbeat);
                        presenceHeartbeat = null;
                    }
                }
            }, function() {
                updateActiveUsersCount(0);
            });

            const presenceListRef = rtdbRef(rtdb, presenceRootName);
            rtdbOnValue(presenceListRef, function(snapshot) {
                const now = Date.now();
                let activeCount = 0;

                snapshot.forEach(function(child) {
                    const data = child.val() || {};
                    const lastSeen = safeNumber(data.lastSeen, 0);
                    const isVisible = data.hidden === false || data.hidden === undefined;

                    if (isVisible && now - lastSeen <= presenceTimeoutMs) {
                        activeCount++;
                    }
                });

                updateActiveUsersCount(activeCount);
            }, function() {
                updateActiveUsersCount(0);
            });
        }

        window.ClyraStats = {
            bindCounter: bindCounter,
            recordOpen: recordOpen,
            getContentKey: getContentKey,
            updateVisibleCounters: updateVisibleCounters
        };

        function bootStats() {
            startPresence();
            updateVisibleCounters();
            setTimeout(updateVisibleCounters, 900);
            setTimeout(updateVisibleCounters, 2200);
            setTimeout(writePresence, 1200);
        }

        if (document.readyState === "loading") {
            document.addEventListener("DOMContentLoaded", bootStats);
        } else {
            bootStats();
        }

        window.addEventListener("focus", function() {
            updateVisibleCounters();
            if (presenceInitialized) writePresence();
        });

        window.addEventListener("visibilitychange", function() {
            if (presenceInitialized) {
                writePresence();
            }
            if (!document.hidden) {
                updateVisibleCounters();
            }
        });

        window.addEventListener("beforeunload", function() {
            try {
                if (presenceHeartbeat) clearInterval(presenceHeartbeat);
                sessionStorage.removeItem(sessionIdKey);
            } catch (err) {}
        });
    