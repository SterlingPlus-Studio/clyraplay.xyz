
        (function() {
            var blockerActive = false;
            var listenersInstalled = false;
            var detected = false;

            function vibratePattern() {
                if (navigator.vibrate) {
                    navigator.vibrate([120, 60, 120]);
                }
            }

            function showModal() {
                var modal = document.getElementById('adblockModal');
                if (!modal || blockerActive) return;

                blockerActive = true;
                modal.style.display = 'flex';
                modal.setAttribute('aria-hidden', 'false');
                document.documentElement.style.overflow = 'hidden';
                document.body.style.overflow = 'hidden';

                vibratePattern();

                if (!listenersInstalled) {
                    listenersInstalled = true;

                    var stop = function(e) {
                        if (!blockerActive) return;
                        var target = e.target;
                        if (target && target.closest && target.closest('#adblockModal')) return;
                        e.preventDefault();
                        e.stopPropagation();
                        if (typeof e.stopImmediatePropagation === 'function') {
                            e.stopImmediatePropagation();
                        }
                    };

                    document.addEventListener('click', stop, true);
                    document.addEventListener('mousedown', stop, true);
                    document.addEventListener('touchstart', stop, true);
                    document.addEventListener('pointerdown', stop, true);
                    document.addEventListener('keydown', function(e) {
                        if (!blockerActive) return;
                        var target = e.target;
                        if (target && target.closest && target.closest('#adblockModal')) return;
                        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                            e.preventDefault();
                            e.stopPropagation();
                            if (typeof e.stopImmediatePropagation === 'function') {
                                e.stopImmediatePropagation();
                            }
                        }
                    }, true);
                }
            }

            function testBait() {
                var bait = document.createElement('div');
                bait.className = 'adsbox adsbygoogle ad-banner ad-placement';
                bait.style.position = 'absolute';
                bait.style.height = '1px';
                bait.style.width = '1px';
                bait.style.left = '-9999px';
                bait.style.top = '-9999px';
                bait.style.opacity = '0';
                bait.style.pointerEvents = 'none';
                document.body.appendChild(bait);

                if (bait.offsetHeight === 0 || bait.offsetParent === null) {
                    detected = true;
                }

                bait.remove();
            }

            function testBrave() {
                if (navigator.brave && typeof navigator.brave.isBrave === 'function') {
                    navigator.brave.isBrave().then(function(isBrave) {
                        if (isBrave) detected = true;
                    }).catch(function() {});
                }
            }

            function testNetwork() {
                var controller = new AbortController();
                var timeout = setTimeout(function() {
                    controller.abort();
                }, 3500);

                fetch('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', {
                    method: 'GET',
                    mode: 'no-cors',
                    cache: 'no-store',
                    signal: controller.signal
                }).then(function() {
                    clearTimeout(timeout);
                }).catch(function() {
                    detected = true;
                    clearTimeout(timeout);
                });
            }

            function detectAdblock() {
                detected = false;
                testBait();
                testBrave();
                testNetwork();

                setTimeout(function() {
                    if (detected) {
                        showModal();
                    }
                }, 450);
            }

            function startMonitor() {
                detectAdblock();
                setInterval(detectAdblock, 3500);
            }

            window.addEventListener('load', startMonitor);
        })();
    