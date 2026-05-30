module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Origin');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'GET') {
        return res.status(405).json({
            error: `Method ${req.method} not allowed. Use GET.`,
            source: 'stream-latency-api'
        });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const started = Date.now();

    try {
        const response = await fetch(`https://noah.watch/stream?latency=${Date.now()}`, {
            cache: 'no-store',
            signal: controller.signal,
            headers: {
                Accept: 'multipart/x-mixed-replace,image/jpeg,image/*,*/*;q=0.8',
                'User-Agent': 'AnukalpPortfolioStreamLatency/1.0'
            }
        });

        const upstreamMs = Date.now() - started;

        try {
            await response.body?.cancel();
        } catch (error) {
            // The stream may already be closed or not expose a cancellable body.
        }

        res.status(200).json({
            ok: response.ok,
            upstreamStatus: response.status,
            upstreamMs,
            source: 'stream-latency-api'
        });
    } catch (error) {
        res.status(504).json({
            error: error.name === 'AbortError' ? 'Stream latency check timed out.' : error.message,
            source: 'stream-latency-api'
        });
    } finally {
        clearTimeout(timeout);
    }
};
