(function () {
    if (window.__portfolioVisitorTrackerLoaded) {
        return;
    }

    window.__portfolioVisitorTrackerLoaded = true;

    const API_FALLBACK_ENDPOINT = 'https://project-a7soe.vercel.app/api/visitor-notify';
    const BATTERY_TIMEOUT_MS = 900;
    const USER_AGENT_DATA_TIMEOUT_MS = 900;

    function getVisitorApiEndpoint() {
        const path = '/api/visitor-notify';
        const hostname = window.location.hostname;
        const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
        const isVercel = hostname.endsWith('.vercel.app');

        if (isLocal || isVercel) {
            return path;
        }

        return API_FALLBACK_ENDPOINT;
    }

    function withTimeout(promise, timeoutMs, fallbackValue) {
        let timeoutId;

        const timeout = new Promise((resolve) => {
            timeoutId = window.setTimeout(() => resolve(fallbackValue), timeoutMs);
        });

        return Promise.race([promise, timeout]).finally(() => {
            window.clearTimeout(timeoutId);
        });
    }

    async function getBatteryInfo() {
        if (!navigator.getBattery) {
            return {
                supported: false,
                status: 'unavailable'
            };
        }

        try {
            const battery = await navigator.getBattery();

            return {
                supported: true,
                level: Math.round((battery.level || 0) * 100),
                charging: Boolean(battery.charging),
                chargingTime: Number.isFinite(battery.chargingTime) ? battery.chargingTime : null,
                dischargingTime: Number.isFinite(battery.dischargingTime) ? battery.dischargingTime : null
            };
        } catch (error) {
            return {
                supported: false,
                status: 'blocked'
            };
        }
    }

    async function getUserAgentData() {
        if (!navigator.userAgentData) {
            return null;
        }

        const baseData = {
            brands: navigator.userAgentData.brands || [],
            mobile: Boolean(navigator.userAgentData.mobile),
            platform: navigator.userAgentData.platform || ''
        };

        if (!navigator.userAgentData.getHighEntropyValues) {
            return baseData;
        }

        try {
            const highEntropyValues = await navigator.userAgentData.getHighEntropyValues([
                'architecture',
                'bitness',
                'fullVersionList',
                'model',
                'platform',
                'platformVersion',
                'uaFullVersion'
            ]);

            return {
                ...baseData,
                ...highEntropyValues
            };
        } catch (error) {
            return baseData;
        }
    }

    function getScreenInfo() {
        return {
            width: window.screen?.width || null,
            height: window.screen?.height || null,
            availWidth: window.screen?.availWidth || null,
            availHeight: window.screen?.availHeight || null,
            colorDepth: window.screen?.colorDepth || null,
            pixelDepth: window.screen?.pixelDepth || null
        };
    }

    function getViewportInfo() {
        return {
            width: window.innerWidth || document.documentElement.clientWidth || null,
            height: window.innerHeight || document.documentElement.clientHeight || null,
            devicePixelRatio: window.devicePixelRatio || 1
        };
    }

    async function buildVisitorPayload() {
        const battery = await withTimeout(
            getBatteryInfo(),
            BATTERY_TIMEOUT_MS,
            { supported: false, status: 'timeout' }
        );
        const userAgentData = await withTimeout(
            getUserAgentData(),
            USER_AGENT_DATA_TIMEOUT_MS,
            null
        );

        return {
            page: {
                title: document.title || 'Untitled page',
                path: `${window.location.pathname}${window.location.search}`,
                url: window.location.href,
                referrer: document.referrer || ''
            },
            client: {
                userAgent: navigator.userAgent || '',
                userAgentData,
                platform: navigator.platform || '',
                language: navigator.language || '',
                languages: navigator.languages || [],
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
                screen: getScreenInfo(),
                viewport: getViewportInfo(),
                touchPoints: navigator.maxTouchPoints || 0,
                battery
            },
            sentAt: new Date().toISOString()
        };
    }

    async function notifyVisit() {
        try {
            const payload = await buildVisitorPayload();

            await fetch(getVisitorApiEndpoint(), {
                method: 'POST',
                mode: 'cors',
                credentials: 'omit',
                keepalive: true,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            // Notification failures should never break the public site.
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', notifyVisit, { once: true });
    } else {
        notifyVisit();
    }
})();
