const NOAH_USER_AGENT = 'AnukalpPortfolioServoProxy/1.0';
const TOKEN_REFRESH_BUFFER_MS = 30000;

let noahSessionCache = null;
let noahSessionPromise = null;

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({
            error: `Method ${req.method} not allowed. Use POST.`,
            source: 'portfolio-api'
        });
    }

    const target = process.env.SERVO_API_URL || 'https://noah.watch/api/servo';

    let targetUrl;
    try {
        targetUrl = new URL(target);
    } catch (error) {
        return res.status(500).json({
            error: 'SERVO_API_URL is not a valid URL.',
            source: 'portfolio-api'
        });
    }

    if (req.method === 'GET') {
        const requestUrl = new URL(req.url || '/api/servo', 'http://portfolio.local');

        if (
            requestUrl.searchParams.get('warm') === '1' &&
            (targetUrl.hostname === 'noah.watch' || targetUrl.hostname.endsWith('.noah.watch')) &&
            process.env.NOAH_WATCH_PROXY_ENABLED === 'true'
        ) {
            try {
                const referer = new URL('/interactive', targetUrl.origin).toString();
                await getNoahSession(targetUrl, referer);
                return res.status(200).json({
                    ok: true,
                    warmed: true,
                    message: 'Noah servo session warmed.',
                    source: 'portfolio-api'
                });
            } catch (error) {
                return res.status(500).json({
                    error: error.message,
                    warmed: false,
                    source: 'portfolio-api'
                });
            }
        }

        return res.status(200).json({
            ok: true,
            message: 'Servo API is online. Use POST to send a command.',
            source: 'portfolio-api'
        });
    }

    const value = Number(req.body?.value);

    if (!Number.isFinite(value) || value < -1 || value > 0) {
        return res.status(400).json({
            error: 'Expected a servo value between -1 and 0.',
            source: 'portfolio-api'
        });
    }

    if (targetUrl.hostname === 'noah.watch' || targetUrl.hostname.endsWith('.noah.watch')) {
        if (process.env.NOAH_WATCH_PROXY_ENABLED !== 'true') {
            return res.status(403).json({
                error: 'Noah proxy is disabled. Set NOAH_WATCH_PROXY_ENABLED=true in Vercel after confirming permission.',
                source: 'portfolio-api'
            });
        }

        try {
            const result = await sendNoahServoCommand(targetUrl, value);
            return res.status(result.status).json(result.data);
        } catch (error) {
            return res.status(500).json({
                error: error.message,
                source: 'portfolio-api'
            });
        }
    }

    try {
        const headers = {
            'Content-Type': 'application/json'
        };

        if (process.env.SERVO_API_KEY) {
            headers.Authorization = `Bearer ${process.env.SERVO_API_KEY}`;
        }

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify({ value })
        });

        const text = await response.text();
        let data = {};

        if (text) {
            try {
                data = JSON.parse(text);
            } catch (error) {
                data = { message: text };
            }
        }

        res.status(response.status).json({
            source: 'custom-servo-api',
            ...data
        });
    } catch (error) {
        res.status(500).json({
            error: error.message,
            source: 'portfolio-api'
        });
    }
};

async function sendNoahServoCommand(targetUrl, value) {
    const referer = new URL('/interactive', targetUrl.origin).toString();
    let session = await getNoahSession(targetUrl, referer);
    let result = await postNoahServoCommand(targetUrl, referer, session, value);

    if (result.status === 401 || result.status === 403) {
        noahSessionCache = null;
        session = await getNoahSession(targetUrl, referer);
        result = await postNoahServoCommand(targetUrl, referer, session, value);
    }

    return result;
}

async function getNoahSession(targetUrl, referer) {
    const now = Date.now();

    if (
        noahSessionCache &&
        noahSessionCache.origin === targetUrl.origin &&
        noahSessionCache.expiresAt > now + TOKEN_REFRESH_BUFFER_MS
    ) {
        return noahSessionCache;
    }

    if (!noahSessionPromise || noahSessionPromise.origin !== targetUrl.origin) {
        noahSessionPromise = {
            origin: targetUrl.origin,
            promise: fetchNoahSession(targetUrl, referer).finally(() => {
                noahSessionPromise = null;
            })
        };
    }

    return noahSessionPromise.promise;
}

async function fetchNoahSession(targetUrl, referer) {
    const tokenUrl = new URL('/api/servo_token', targetUrl.origin);
    const tokenResponse = await fetch(tokenUrl, {
        headers: {
            Accept: 'application/json',
            Referer: referer,
            'User-Agent': NOAH_USER_AGENT
        }
    });

    const tokenText = await tokenResponse.text();
    const tokenData = parseResponseBody(tokenText);

    if (!tokenResponse.ok || !tokenData.token) {
        throw new Error(tokenData.error || tokenData.message || `Could not get Noah servo token: HTTP ${tokenResponse.status}`);
    }

    const cookie = getCookieHeader(tokenResponse.headers.get('set-cookie'));
    const ttlSeconds = Number(tokenData.ttl || 1800);

    noahSessionCache = {
        origin: targetUrl.origin,
        token: tokenData.token,
        cookie,
        expiresAt: Date.now() + Math.max(60, ttlSeconds - 15) * 1000
    };

    return noahSessionCache;
}

async function postNoahServoCommand(targetUrl, referer, session, value) {
    const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Referer: referer,
        'X-Servo-Token': session.token,
        'User-Agent': NOAH_USER_AGENT
    };

    if (session.cookie) {
        headers.Cookie = session.cookie;
    }

    const servoResponse = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ value })
    });

    const servoText = await servoResponse.text();
    const servoData = parseResponseBody(servoText);

    return {
        status: servoResponse.status,
        data: servoResponse.ok
            ? { message: 'Command sent to Noah servo.', source: 'noah-servo-api', ...servoData }
            : { source: 'noah-servo-api', ...servoData }
    };
}

function parseResponseBody(text) {
    if (!text) {
        return {};
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        return { message: text };
    }
}

function getCookieHeader(setCookieHeader) {
    if (!setCookieHeader) {
        return '';
    }

    return setCookieHeader
        .split(/,(?=\s*[^;,]+=)/)
        .map((cookie) => cookie.split(';')[0].trim())
        .filter(Boolean)
        .join('; ');
}
