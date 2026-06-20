const crypto = require('crypto');

const DEFAULT_ALLOWED_ORIGINS = [
    'https://glitchyn.online',
    'https://www.glitchyn.online',
    'https://project-a7soe.vercel.app',
    'https://lionshaft.netlify.app',
    'https://www.lionshaft.netlify.app',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001'
];
const MAX_FIELD_VALUE_LENGTH = 1024;
const MAX_TEXT_LENGTH = 400;
const memoryCounters = new Map();

exports.handler = async function handler(event) {
    const origin = cleanOrigin(getHeader(event.headers, 'origin'));
    const allowedOrigins = getAllowedOrigins(event);
    const allowed = !origin || isOriginAllowed(origin, allowedOrigins, event);

    const responseHeaders = {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
        'Vary': 'Origin'
    };

    if (origin && allowed) {
        responseHeaders['Access-Control-Allow-Origin'] = origin;
    } else if (!origin) {
        responseHeaders['Access-Control-Allow-Origin'] = '*';
    }

    if (event.httpMethod === 'OPTIONS') {
        responseHeaders['Access-Control-Allow-Methods'] = 'POST,OPTIONS';
        responseHeaders['Access-Control-Allow-Headers'] = 'Content-Type';

        return {
            statusCode: allowed ? 204 : 403,
            headers: responseHeaders,
            body: ''
        };
    }

    if (!allowed) {
        return {
            statusCode: 403,
            headers: responseHeaders,
            body: JSON.stringify({
                error: 'Origin is not allowed.',
                source: 'visitor-notify-netlify'
            })
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: responseHeaders,
            body: JSON.stringify({
                error: `Method ${event.httpMethod} not allowed. Use POST.`,
                source: 'visitor-notify-netlify'
            })
        };
    }

    try {
        const payload = parseBody(event.body);
        const ip = getClientIp(event);

        if (shouldIgnoreIp(ip)) {
            return {
                statusCode: 200,
                headers: responseHeaders,
                body: JSON.stringify({
                    ok: true,
                    ignored: true,
                    source: 'visitor-notify-netlify'
                })
            };
        }

        const page = getPageInfo(payload.page || {});
        const client = payload.client || {};
        const counts = await incrementVisitCounters(ip, page.path);
        const location = getLocationFromHeaders(event);
        const color = getColorForIp(ip);

        if (!process.env.DISCORD_WEBHOOK_URL) {
            return {
                statusCode: 200,
                headers: responseHeaders,
                body: JSON.stringify({
                    ok: false,
                    configured: false,
                    message: 'DISCORD_WEBHOOK_URL is not set.',
                    counts,
                    source: 'visitor-notify-netlify'
                })
            };
        }

        const discordPayload = buildDiscordPayload({
            ip,
            page,
            client,
            counts,
            location,
            color
        });

        const discordResponse = await fetch(process.env.DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(discordPayload)
        });

        if (!discordResponse.ok) {
            const text = await discordResponse.text().catch(() => '');
            return {
                statusCode: 502,
                headers: responseHeaders,
                body: JSON.stringify({
                    error: 'Discord webhook request failed.',
                    discordStatus: discordResponse.status,
                    details: truncate(text, 300),
                    source: 'visitor-notify-netlify'
                })
            };
        }

        return {
            statusCode: 200,
            headers: responseHeaders,
            body: JSON.stringify({
                ok: true,
                counts,
                source: 'visitor-notify-netlify'
            })
        };
    } catch (error) {
        return {
            statusCode: 500,
            headers: responseHeaders,
            body: JSON.stringify({
                error: error.message,
                source: 'visitor-notify-netlify'
            })
        };
    }
};

function getAllowedOrigins(event) {
    const origins = new Set(DEFAULT_ALLOWED_ORIGINS);
    const configured = splitCsv(process.env.VISITOR_ALLOWED_ORIGINS);

    configured.forEach((origin) => origins.add(cleanOrigin(origin)));

    if (event.headers?.host) {
        const host = event.headers.host;
        origins.add(`https://${host}`);
        origins.add(`http://${host}`);
    }

    return new Set(Array.from(origins).filter(Boolean));
}

function isOriginAllowed(origin, allowedOrigins, event) {
    if (allowedOrigins.has(origin)) {
        return true;
    }

    try {
        const originHostname = new URL(origin).hostname.toLowerCase();
        const requestHost = String(event.headers?.host || '').toLowerCase();
        const requestHostname = requestHost.split(':')[0];

        return originHostname === requestHostname ||
            originHostname === 'lionshaft.netlify.app' ||
            originHostname.endsWith('.netlify.app') ||
            originHostname.endsWith('.netlify.com') ||
            originHostname.endsWith('.vercel.app') ||
            requestHostname === 'lionshaft.netlify.app' ||
            requestHostname.endsWith('.netlify.app') ||
            requestHostname.endsWith('.netlify.com') ||
            requestHostname.endsWith('.vercel.app') ||
            requestHostname === 'localhost' ||
            requestHostname === '127.0.0.1';
    } catch (error) {
        return false;
    }
}

function cleanOrigin(origin) {
    return String(origin || '').replace(/\/+$/, '');
}

function parseBody(body) {
    if (!body) {
        return {};
    }

    if (typeof body === 'object') {
        return body;
    }

    try {
        return JSON.parse(body);
    } catch (error) {
        return {};
    }
}

function getHeader(headers = {}, key) {
    const value = headers[key] || headers[key.toLowerCase()] || '';
    return String(value || '');
}

function getClientIp(event) {
    const headers = event.headers || {};
    const forwardedFor = getHeader(headers, 'x-forwarded-for');
    const candidates = [
        getHeader(headers, 'cf-connecting-ip'),
        getHeader(headers, 'x-nf-client-connection-ip'),
        getHeader(headers, 'x-real-ip'),
        forwardedFor ? forwardedFor.split(',')[0] : '',
        getHeader(headers, 'client-ip')
    ];

    const ip = candidates
        .map((value) => String(value || '').trim())
        .find(Boolean);

    return normalizeIp(ip || 'unknown');
}

function normalizeIp(ip) {
    return String(ip || 'unknown')
        .replace(/^::ffff:/, '')
        .trim() || 'unknown';
}

function shouldIgnoreIp(ip) {
    return splitCsv(process.env.VISITOR_IGNORE_IPS)
        .map(normalizeIp)
        .includes(normalizeIp(ip));
}

async function incrementVisitCounters(ip, pagePath) {
    const ipHash = hashText(normalizeIp(ip));
    const pageHash = hashText(pagePath || '/');
    const totalKey = `portfolio:visitor:${ipHash}:total`;
    const pageKey = `portfolio:visitor:${ipHash}:page:${pageHash}`;

    const [totalVisits, pageVisits] = await Promise.all([
        incrementCounter(totalKey),
        incrementCounter(pageKey)
    ]);

    return {
        totalVisits,
        pageVisits
    };
}

async function incrementCounter(key) {
    const nextValue = (memoryCounters.get(key) || 0) + 1;
    memoryCounters.set(key, nextValue);
    return nextValue;
}

function getLocationFromHeaders(event) {
    const headers = event.headers || {};
    return {
        city: decodeHeader(getHeader(headers, 'x-nf-geo-city')),
        region: decodeHeader(getHeader(headers, 'x-nf-geo-region')),
        country: decodeHeader(getHeader(headers, 'x-nf-geo-country')),
        timezone: decodeHeader(getHeader(headers, 'x-nf-geo-timezone')),
        latitude: decodeHeader(getHeader(headers, 'x-nf-geo-latitude')),
        longitude: decodeHeader(getHeader(headers, 'x-nf-geo-longitude'))
    };
}

function decodeHeader(value) {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }

    try {
        return decodeURIComponent(text);
    } catch (error) {
        return text;
    }
}

function getPageInfo(page = {}) {
    const path = truncate(cleanText(page.path || '/'), 220) || '/';
    return {
        title: truncate(cleanText(page.title || 'Untitled page'), 180),
        path,
        url: getSafeUrl(page.url),
        referrer: truncate(cleanText(page.referrer || ''), 350)
    };
}

function getSafeUrl(url) {
    try {
        const parsed = new URL(String(url || ''));
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
            return truncate(parsed.toString(), 500);
        }
    } catch (error) {
        return '';
    }

    return '';
}

function buildDiscordPayload({ ip, page, client, counts, location, color }) {
    const ua = cleanText(client.userAgent || '');
    const browser = detectBrowser(ua, client.userAgentData);
    const os = detectOs(ua, client);
    const locationText = formatLocation(location);
    const resolutionText = formatResolution(client.screen, client.viewport);
    const batteryText = formatBattery(client.battery);
    const languageText = formatLanguage(client);
    const referrerText = page.referrer || 'Direct / unavailable';

    return {
        username: 'Portfolio Visitor',
        embeds: [
            {
                title: 'New website visit',
                description: truncate(`${page.title}\n${page.path}`, 350),
                url: page.url || undefined,
                color,
                fields: [
                    createField('IP Address', wrapCode(ip), true),
                    createField('Visit Count', `Total from IP: ${counts.totalVisits}\nThis page: ${counts.pageVisits}`, true),
                    createField('Location', locationText, false),
                    createField('OS', os, true),
                    createField('Browser', browser, true),
                    createField('Battery', batteryText, true),
                    createField('Resolution', resolutionText, false),
                    createField('Language / Timezone', languageText, false),
                    createField('Referrer', referrerText, false)
                ],
                timestamp: new Date().toISOString(),
                footer: {
                    text: 'Embed color is generated from the visitor IP.'
                }
            }
        ]
    };
}

function createField(name, value, inline = false) {
    return {
        name,
        value: truncate(cleanText(value || 'Unknown'), MAX_FIELD_VALUE_LENGTH) || 'Unknown',
        inline
    };
}

function formatLocation(location) {
    const parts = [location.city, location.region, location.country].filter(Boolean);
    const lines = [];

    lines.push(parts.length ? parts.join(', ') : 'Unavailable');

    if (location.timezone) {
        lines.push(`Timezone: ${location.timezone}`);
    }

    if (location.latitude && location.longitude) {
        lines.push(`Lat/Lon: ${location.latitude}, ${location.longitude}`);
    }

    return lines.join('\n');
}

function formatResolution(screen = {}, viewport = {}) {
    const lines = [];

    if (screen.width && screen.height) {
        lines.push(`Screen: ${screen.width} x ${screen.height}`);
    }

    if (viewport.width && viewport.height) {
        lines.push(`Viewport: ${viewport.width} x ${viewport.height}`);
    }

    if (viewport.devicePixelRatio) {
        lines.push(`DPR: ${Number(viewport.devicePixelRatio).toFixed(2)}`);
    }

    return lines.length ? lines.join('\n') : 'Unavailable';
}

function formatBattery(battery = {}) {
    if (!battery.supported) {
        return `Unavailable${battery.status ? ` (${battery.status})` : ''}`;
    }

    const lines = [
        `Level: ${Number.isFinite(battery.level) ? `${battery.level}%` : 'Unknown'}`,
        `Charging: ${battery.charging ? 'Yes' : 'No'}`
    ];

    if (Number.isFinite(battery.chargingTime) && battery.chargingTime > 0) {
        lines.push(`Charge time: ${formatSeconds(battery.chargingTime)}`);
    }

    if (Number.isFinite(battery.dischargingTime) && battery.dischargingTime > 0) {
        lines.push(`Discharge time: ${formatSeconds(battery.dischargingTime)}`);
    }

    return lines.join('\n');
}

function formatSeconds(seconds) {
    if (!Number.isFinite(seconds)) {
        return 'Unknown';
    }
    if (seconds === Infinity) {
        return 'Unknown';
    }
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) {
        return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
}

function formatLanguage(client = {}) {
    const lines = [];
    const language = cleanText(client.language || '');
    const timezone = cleanText(client.timezone || '');

    if (language) {
        lines.push(`Language: ${language}`);
    }

    if (timezone) {
        lines.push(`Client timezone: ${timezone}`);
    }

    return lines.length ? lines.join('\n') : 'Unavailable';
}

function detectBrowser(ua, userAgentData = {}) {
    const brandName = getBrowserFromBrands(userAgentData);
    if (brandName) {
        return brandName;
    }

    const matchers = [
        ['Microsoft Edge', /Edg\/([\d.]+)/],
        ['Opera', /OPR\/([\d.]+)/],
        ['Samsung Internet', /SamsungBrowser\/([\d.]+)/],
        ['Firefox', /Firefox\/([\d.]+)/],
        ['Chrome', /Chrome\/([\d.]+)/],
        ['Safari', /Version\/([\d.]+).*Safari/]
    ];

    for (const [name, regex] of matchers) {
        const match = ua.match(regex);
        if (match) {
            return `${name} ${match[1]}`;
        }
    }

    return ua ? truncate(ua, MAX_TEXT_LENGTH) : 'Unknown';
}

function getBrowserFromBrands(userAgentData = {}) {
    const fullVersionList = Array.isArray(userAgentData.fullVersionList)
        ? userAgentData.fullVersionList
        : [];
    const brands = fullVersionList.length && fullVersionList[0].brand
        ? fullVersionList
        : Array.isArray(userAgentData.brands)
            ? userAgentData.brands
            : [];
    const filtered = brands.filter((brand) => !/not/i.test(brand.brand || ''));

    if (!filtered.length) {
        return '';
    }

    const preferred = filtered.find((brand) => /edge/i.test(brand.brand)) ||
        filtered.find((brand) => /chrome/i.test(brand.brand)) ||
        filtered.find((brand) => /chromium/i.test(brand.brand)) ||
        filtered[0];

    return `${preferred.brand}${preferred.version ? ` ${preferred.version}` : ''}`;
}

function detectOs(ua, client = {}) {
    const os = cleanText(client.platform || '');
    if (os) {
        return os;
    }

    if (/Windows/i.test(ua)) {
        return 'Windows';
    }
    if (/Mac OS X/i.test(ua)) {
        return 'macOS';
    }
    if (/Android/i.test(ua)) {
        return 'Android';
    }
    if (/iPhone|iPad|iPod/i.test(ua)) {
        return 'iOS';
    }
    if (/Linux/i.test(ua)) {
        return 'Linux';
    }

    return 'Unknown';
}

function splitCsv(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function truncate(text, maxLength) {
    const value = cleanText(text);
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.slice(0, maxLength - 1)}…`;
}

function cleanText(value) {
    return String(value || '')
        .replace(/[\u0000-\u001F\u007F]/g, '')
        .trim();
}

function wrapCode(text) {
    return `\`${cleanText(text || '')}\``;
}

function hashText(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function getColorForIp(ip) {
    const base = hashText(ip || 'unknown');
    const color = parseInt(base.slice(0, 6), 16) % 0xFFFFFF;
    return color === 0 ? 1 : color;
}
