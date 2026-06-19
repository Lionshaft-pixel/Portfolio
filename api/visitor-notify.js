const crypto = require('crypto');

const DEFAULT_ALLOWED_ORIGINS = [
    'https://glitchyn.online',
    'https://www.glitchyn.online',
    'https://project-a7soe.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:3001'
];
const MAX_FIELD_VALUE_LENGTH = 1024;
const MAX_TEXT_LENGTH = 400;
const memoryCounters = new Map();

module.exports = async function handler(req, res) {
    const cors = applyCors(req, res);
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') {
        res.status(cors.allowed ? 204 : 403).end();
        return;
    }

    if (!cors.allowed) {
        return res.status(403).json({
            error: 'Origin is not allowed.',
            source: 'visitor-notify-api'
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({
            error: `Method ${req.method} not allowed. Use POST.`,
            source: 'visitor-notify-api'
        });
    }

    try {
        const payload = await getRequestPayload(req);
        const ip = getClientIp(req);

        if (shouldIgnoreIp(ip)) {
            return res.status(200).json({
                ok: true,
                ignored: true,
                source: 'visitor-notify-api'
            });
        }

        const page = getPageInfo(payload.page);
        const client = payload.client || {};
        const counts = await incrementVisitCounters(ip, page.path);
        const location = getVercelLocation(req);
        const color = getColorForIp(ip);

        if (!process.env.DISCORD_WEBHOOK_URL) {
            return res.status(200).json({
                ok: false,
                configured: false,
                message: 'DISCORD_WEBHOOK_URL is not set.',
                counts,
                source: 'visitor-notify-api'
            });
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
            return res.status(502).json({
                error: 'Discord webhook request failed.',
                discordStatus: discordResponse.status,
                details: truncate(text, 300),
                source: 'visitor-notify-api'
            });
        }

        res.status(200).json({
            ok: true,
            counts,
            source: 'visitor-notify-api'
        });
    } catch (error) {
        res.status(500).json({
            error: error.message,
            source: 'visitor-notify-api'
        });
    }
};

function applyCors(req, res) {
    const origin = cleanOrigin(req.headers.origin || '');
    const allowedOrigins = getAllowedOrigins(req);
    const allowed = !origin || allowedOrigins.has(origin);

    if (origin && allowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (!origin) {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }

    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');

    return { allowed };
}

function getAllowedOrigins(req) {
    const origins = new Set(DEFAULT_ALLOWED_ORIGINS);
    const configured = splitCsv(process.env.VISITOR_ALLOWED_ORIGINS);

    configured.forEach((origin) => origins.add(cleanOrigin(origin)));

    if (process.env.VERCEL_URL) {
        origins.add(`https://${process.env.VERCEL_URL}`);
    }

    if (req.headers.host) {
        const host = req.headers.host;
        origins.add(`https://${host}`);

        if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) {
            origins.add(`http://${host}`);
        }
    }

    return new Set(Array.from(origins).filter(Boolean));
}

function cleanOrigin(origin) {
    return String(origin || '').replace(/\/+$/, '');
}

async function getRequestPayload(req) {
    if (typeof req.body === 'string') {
        return req.body ? JSON.parse(req.body) : {};
    }

    if (req.body && typeof req.body === 'object') {
        return req.body;
    }

    const raw = await readRequestBody(req);
    return raw ? JSON.parse(raw) : {};
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';

        req.on('data', (chunk) => {
            body += chunk;
        });

        req.on('end', () => resolve(body));
        req.on('error', reject);
    });
}

function getClientIp(req) {
    const forwardedFor = getHeader(req, 'x-forwarded-for');
    const candidates = [
        getHeader(req, 'cf-connecting-ip'),
        getHeader(req, 'x-real-ip'),
        forwardedFor ? forwardedFor.split(',')[0] : '',
        req.socket?.remoteAddress || ''
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
    const kv = getKvConfig();

    if (kv) {
        const response = await fetch(`${kv.url}/incr/${encodeURIComponent(key)}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${kv.token}`
            }
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(data.error || `Counter storage failed: HTTP ${response.status}`);
        }

        return Number(data.result || 0);
    }

    const nextValue = (memoryCounters.get(key) || 0) + 1;
    memoryCounters.set(key, nextValue);
    return nextValue;
}

function getKvConfig() {
    const url = process.env.VISITOR_KV_REST_API_URL ||
        process.env.KV_REST_API_URL ||
        process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.VISITOR_KV_REST_API_TOKEN ||
        process.env.KV_REST_API_TOKEN ||
        process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
        return null;
    }

    return {
        url: String(url).replace(/\/+$/, ''),
        token
    };
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

function getVercelLocation(req) {
    const city = decodeHeader(getHeader(req, 'x-vercel-ip-city'));
    const region = decodeHeader(getHeader(req, 'x-vercel-ip-country-region'));
    const country = decodeHeader(getHeader(req, 'x-vercel-ip-country'));
    const timezone = decodeHeader(getHeader(req, 'x-vercel-ip-timezone'));
    const latitude = decodeHeader(getHeader(req, 'x-vercel-ip-latitude'));
    const longitude = decodeHeader(getHeader(req, 'x-vercel-ip-longitude'));

    return {
        city,
        region,
        country,
        timezone,
        latitude,
        longitude
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
    const parts = [
        location.city,
        location.region,
        location.country
    ].filter(Boolean);
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
    const platform = cleanText(client.userAgentData?.platform || client.platform || '');
    const platformVersion = cleanText(client.userAgentData?.platformVersion || '');

    if (platform) {
        return platformVersion ? `${platform} ${platformVersion}` : platform;
    }

    const matchers = [
        ['Windows', /Windows NT ([\d.]+)/],
        ['Android', /Android ([\d.]+)/],
        ['iOS', /(iPhone|iPad|iPod).*OS ([\d_]+)/],
        ['macOS', /Mac OS X ([\d_]+)/],
        ['Linux', /Linux/]
    ];

    for (const [name, regex] of matchers) {
        const match = ua.match(regex);

        if (!match) {
            continue;
        }

        const version = (match[2] || match[1] || '').replace(/_/g, '.');
        return version && version !== name ? `${name} ${version}` : name;
    }

    return 'Unknown';
}

function getColorForIp(ip) {
    const hash = crypto.createHash('sha256').update(normalizeIp(ip)).digest();
    const hue = Math.round(((hash[0] << 8) + hash[1]) / 65535 * 359);
    const saturation = 68 + (hash[2] % 18);
    const lightness = 45 + (hash[3] % 12);
    const { r, g, b } = hslToRgb(hue, saturation / 100, lightness / 100);

    return (r << 16) + (g << 8) + b;
}

function hslToRgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;
    let r = 0;
    let g = 0;
    let b = 0;

    if (h < 60) {
        r = c;
        g = x;
    } else if (h < 120) {
        r = x;
        g = c;
    } else if (h < 180) {
        g = c;
        b = x;
    } else if (h < 240) {
        g = x;
        b = c;
    } else if (h < 300) {
        r = x;
        b = c;
    } else {
        r = c;
        b = x;
    }

    return {
        r: Math.round((r + m) * 255),
        g: Math.round((g + m) * 255),
        b: Math.round((b + m) * 255)
    };
}

function getHeader(req, name) {
    const value = req.headers[name.toLowerCase()];

    if (Array.isArray(value)) {
        return value[0] || '';
    }

    return value || '';
}

function hashText(text) {
    return crypto.createHash('sha256').update(String(text || '')).digest('hex').slice(0, 24);
}

function wrapCode(value) {
    return `\`${String(value || '').replace(/`/g, '')}\``;
}

function cleanText(value) {
    return String(value || '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function truncate(value, maxLength) {
    const text = String(value || '');

    if (text.length <= maxLength) {
        return text;
    }

    return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function splitCsv(value) {
    return String(value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}
